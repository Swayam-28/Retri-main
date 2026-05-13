import io
import base64
import numpy as np
import requests
import os
import json
import argparse
from flask import Flask, request, jsonify
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import faiss
import torch

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

# --- Initialization ---

# 1. Initialize Flask App
app = Flask(__name__)

# 2. Load CLIP Model and Processor
# This will download the model on first run. It's a one-time setup.
MODEL_NAME = "openai/clip-vit-base-patch32"
print("Loading CLIP model... This may take a moment.")
model = CLIPModel.from_pretrained(MODEL_NAME)
processor = CLIPProcessor.from_pretrained(MODEL_NAME)
print("CLIP model loaded successfully.")

# 3. Initialize Vector Database (Faiss)
# The dimension of the vectors produced by the CLIP model is 512.
EMBEDDING_DIM = 512
# Using a simple IndexFlatL2 for Euclidean distance search.
index = faiss.IndexFlatL2(EMBEDDING_DIM)

# 4. In-memory storage for mapping Faiss index IDs to our database item IDs
# This is a simple approach for this guide. For production, you'd use a persistent key-value store.
id_map = {}
item_id_to_faiss_id = {}

# 5. Persistence setup
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(SCRIPT_DIR, "faiss_index.idx")
MAPPINGS_FILE = os.path.join(SCRIPT_DIR, "mappings.json")

def load_persistence():
    """Load the Faiss index and mappings from disk if they exist."""
    global index, id_map, item_id_to_faiss_id
    
    if os.path.exists(INDEX_FILE) and os.path.getsize(INDEX_FILE) > 0:
        try:
            index = faiss.read_index(INDEX_FILE)
            print(f"Loaded Faiss index with {index.ntotal} vectors.")
        except Exception as e:
            print(f"Error reading Faiss index ({e}). Starting fresh.")
    else:
        print("No existing Faiss index found (or file is empty). Starting fresh.")

    if os.path.exists(MAPPINGS_FILE) and os.path.getsize(MAPPINGS_FILE) > 0:
        try:
            with open(MAPPINGS_FILE, 'r') as f:
                data = json.load(f)
                id_map = {int(k): v for k, v in data.get('id_map', {}).items()}
                item_id_to_faiss_id = data.get('item_id_to_faiss_id', {})
            print(f"Loaded mappings for {len(item_id_to_faiss_id)} items.")
        except Exception as e:
            print(f"Error reading mappings file ({e}). Starting fresh.")
    else:
        print("No existing mappings found (or file is empty). Starting fresh.")

def save_persistence():
    """Save the Faiss index and mappings to disk."""
    faiss.write_index(index, INDEX_FILE)
    with open(MAPPINGS_FILE, 'w') as f:
        json.dump({
            'id_map': id_map,
            'item_id_to_faiss_id': item_id_to_faiss_id
        }, f)
    print("Persistence saved.")

# Load persistence on startup (moved to main block)

# --- Helper Functions ---

def get_image_embedding(image_url):
    """Downloads an image, processes it, and returns its embedding."""
    try:
        if image_url.startswith('data:'):
            if 'image/svg+xml' in image_url:
                # Pillow cannot open SVGs, so we use a blank image as a fallback
                # This ensures the embedding relies purely on the text description
                image = Image.new('RGB', (224, 224), (255, 255, 255))
            else:
                # Handle data URL
                header, encoded = image_url.split(',', 1)
                image_data = base64.b64decode(encoded)
                image = Image.open(io.BytesIO(image_data)).convert("RGB")
        else:
            response = requests.get(image_url, stream=True)
            response.raise_for_status()
            image = Image.open(io.BytesIO(response.content)).convert("RGB")
        inputs = processor(images=image, return_tensors="pt", padding=True)
        with torch.no_grad():
            image_features = model.get_image_features(pixel_values=inputs.pixel_values)
        return image_features[0].numpy()
    except Exception as e:
        print(f"Error getting image embedding for {image_url}: {e}")
        return None

def get_text_embedding(text):
    """Processes text and returns its embedding."""
    try:
        inputs = processor(text=text, return_tensors="pt", padding=True, truncation=True, max_length=77)
        with torch.no_grad():
            text_features = model.get_text_features(input_ids=inputs.input_ids)
        return text_features[0].numpy()
    except Exception as e:
        print(f"Error getting text embedding for '{text}': {e}")
        return None

# --- API Endpoints ---

@app.route("/status", methods=["GET"])
def get_status():
    """
    Returns the list of item IDs currently in the AI index.
    Used by the node server to gentle-sync lost items.
    """
    return jsonify({"indexed_ids": list(item_id_to_faiss_id.keys())})

@app.route("/add_item", methods=["POST"])
def add_item():
    """
    Receives item data, creates a combined embedding, and adds it to the Faiss index.
    """
    try:
        data = request.get_json()
        item_id = data.get("itemId")
        description = data.get("description", "")
        title = data.get("title", "")
        image_url = data.get("imageUrl")

        if not item_id or not image_url:
            return jsonify({"error": "itemId and imageUrl are required"}), 400

        # Combine title and description for a richer text embedding
        full_text = f"{title}: {description}"

        # Generate embeddings
        text_embedding = get_text_embedding(full_text)
        image_embedding = get_image_embedding(image_url)

        if text_embedding is None or image_embedding is None:
            return jsonify({"error": "Failed to generate embeddings"}), 500

        # Normalize individual vectors before averaging so one doesn't dominate
        faiss.normalize_L2(text_embedding.reshape(1, -1))
        faiss.normalize_L2(image_embedding.reshape(1, -1))
        
        # Combine embeddings by averaging them. This is a simple but effective strategy.
        combined_embedding = np.mean([text_embedding, image_embedding], axis=0)
        
        # Normalize the vector for consistent distance metrics
        faiss.normalize_L2(combined_embedding.reshape(1, -1))

        # Add to Faiss index
        index.add(combined_embedding.reshape(1, -1).astype('float32'))
        
        # The ID in the Faiss index is its position. We store this position.
        faiss_id = index.ntotal - 1
        id_map[faiss_id] = item_id
        item_id_to_faiss_id[item_id] = faiss_id

        print(f"Successfully added item {item_id} to index. Total items: {index.ntotal}")
        # Save persistence after adding an item
        save_persistence()
        return jsonify({"status": "success", "itemId": item_id, "faissId": faiss_id}), 201

    except Exception as e:
        print(f"An error occurred in /add_item: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route("/search", methods=["GET"])
def search():
    """
    Performs a search based on a text query and returns the top N most similar items.
    """
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({"error": "query parameter is required"}), 400

        # Generate embedding for the query
        query_embedding = get_text_embedding(query)
        if query_embedding is None:
            return jsonify({"error": "Failed to generate query embedding"}), 500

        # Normalize the query vector
        faiss.normalize_L2(query_embedding.reshape(1, -1))

        # Search the index for a larger number of neighbors to prevent deleted items from shadowing
        k = 50
        distances, indices = index.search(query_embedding.reshape(1, -1).astype('float32'), k)

        # Process results
        matches = []
        for i in range(len(indices[0])):
            faiss_id = indices[0][i]
            match_item_id = id_map.get(faiss_id)
            if match_item_id:
                raw_distance = float(distances[0][i])
                similarity_score = 1.0 - (raw_distance / 2.0)
                
                matches.append({
                    "itemId": match_item_id,
                    "distance": raw_distance,
                    "score": round(similarity_score, 4)
                })

        print(f"Found {len(matches)} matches for query '{query}'")
        return jsonify({"matches": matches})

    except Exception as e:
        print(f"An error occurred in /search: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500


@app.route("/find_matches", methods=["GET"])
def find_matches():
    """
    Finds the top N most similar items for a given item_id.
    """
    try:
        item_id_to_match = request.args.get('item_id')
        if not item_id_to_match:
            return jsonify({"error": "item_id query parameter is required"}), 400

        # Find the Faiss ID for the given item_id
        target_faiss_id = item_id_to_faiss_id.get(item_id_to_match)
        
        if target_faiss_id is None:
            return jsonify({"error": "Item not found in the search index"}), 404

        # Reconstruct the vector from the index
        vector_to_search = index.reconstruct(target_faiss_id).reshape(1, -1)

        # Search the index for a larger number of neighbors to prevent deleted items from shadowing
        # We search for a high k because deleted items might still be in the FAISS index
        k = 50
        distances, indices = index.search(vector_to_search, k)

        # Process results
        matches = []
        for i in range(len(indices[0])):
            faiss_id = indices[0][i]
            # Get the original item_id from our map
            match_item_id = id_map.get(faiss_id)
            
            # Skip if it's the item itself or if the ID isn't found
            if match_item_id == item_id_to_match or match_item_id is None:
                continue
            
            raw_distance = float(distances[0][i])
            
            # Convert FAISS squared L2 distance to a 0.0 - 1.0 similarity score
            similarity_score = 1.0 - (raw_distance / 2.0)

            matches.append({
                "itemId": match_item_id,
                "distance": raw_distance,         # Keep this for backward compatibility
                "score": round(similarity_score, 4) # Node.js can use this directly!
            })

        print(f"Found {len(matches)} matches for item {item_id_to_match}")
        return jsonify({"matches": matches})

    except Exception as e:
        print(f"An error occurred in /find_matches: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

# --- Main Execution ---

if __name__ == "__main__":
    # Always attempt to load persisted data on startup
    load_persistence()

    # Running in debug mode is convenient for development but should be disabled for production.
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)