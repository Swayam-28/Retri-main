// RETRIEVIX - Lost & Found Platform JavaScript (MongoDB-backed, full features restored)

class RetrievixApp {
    constructor() {
        // State
        this.currentUser = null;
        this.currentPage = 'home';
        this.currentTab = 'lost'; // 'lost' | 'found'
        this.currentReportType = null;
        this.currentFilters = { search: '', category: '', location: '', date: '' };
        this.currentPageNum = 1;
        this.itemsPerPage = 6;

        // Static data for dropdowns
        this.categories = [
            "Electronics", "Clothing", "Accessories", "Documents",
            "Keys", "Bags", "Jewelry", "Sports Equipment", "Books", "Other"
        ];
        this.commonLocations = [
            "Central Station", "University Campus", "Coffee Bean Cafe",
            "Main Street Bus Stop", "City Mall", "Library", "Park",
            "Hotel Lobby", "Restaurant", "Airport Terminal"
        ];

        // Init
        this.socket = null;
        this.activeRoomId = null;
        this.initializeEventListeners();
        this.checkAuthState();
        this.populateDropdowns();
        
        // Handle direct URL routing for chat rooms
        const urlParams = new URLSearchParams(window.location.search);
        const room = urlParams.get('room');
        if (room) {
            setTimeout(() => {
                this.navigateToPage('messages');
                if (this.currentUser) {
                    this.openChatRoom(room);
                } else {
                    this.showModal('loginModal');
                }
            }, 500);
        }
    }

    // ====== API Helper ======
    async apiRequest(endpoint, method = "GET", body = null) {
        const options = { method, headers: { "Content-Type": "application/json" } };
        if (body) options.body = JSON.stringify(body);
        try {
            const res = await fetch(`/api/${endpoint}`, options);
            return await res.json();
        } catch (err) {
            console.error("API Error:", err);
            return { success: false, message: "Server error" };
        }
    }

    // ====== Event Listeners ======
    initializeEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateToPage(page);
            });
        });

        // Auth buttons
        document.getElementById('loginBtn')?.addEventListener('click', () => this.showModal('loginModal'));
        document.getElementById('registerBtn')?.addEventListener('click', () => this.showModal('registerModal'));
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

        // Modal controls
        document.getElementById('closeLoginModal')?.addEventListener('click', () => this.hideModal('loginModal'));
        document.getElementById('closeRegisterModal')?.addEventListener('click', () => this.hideModal('registerModal'));
        document.getElementById('closeContactModal')?.addEventListener('click', () => this.hideModal('contactModal'));
        document.getElementById('switchToRegister')?.addEventListener('click', () => {
            this.hideModal('loginModal');
            this.showModal('registerModal');
        });
        document.getElementById('switchToLogin')?.addEventListener('click', () => {
            this.hideModal('registerModal');
            this.showModal('loginModal');
        });

        // Forms
        document.getElementById('loginForm')?.addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('registerForm')?.addEventListener('submit', (e) => this.handleRegister(e));
        document.getElementById('reportForm')?.addEventListener('submit', (e) => this.handleReportSubmit(e));

        // Hero buttons
        document.getElementById('reportLostBtn')?.addEventListener('click', () => this.showReportForm('lost'));
        document.getElementById('reportFoundBtn')?.addEventListener('click', () => this.showReportForm('found'));

        // Search & filters
        document.getElementById('searchBtn')?.addEventListener('click', () => this.performSearch());
        document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });
        document.getElementById('categoryFilter')?.addEventListener('change', () => this.performSearch());
        document.getElementById('locationFilter')?.addEventListener('change', () => this.performSearch());
        document.getElementById('dateFilter')?.addEventListener('change', () => this.performSearch());

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Image upload
        document.getElementById('imageUpload')?.addEventListener('click', () => {
            document.getElementById('imageInput').click();
        });
        document.getElementById('imageInput')?.addEventListener('change', (e) => this.handleImageUpload(e));
        document.getElementById('removeImage')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeImage();
        });

        // Cancel report
        document.getElementById('cancelReport')?.addEventListener('click', () => {
            this.navigateToPage('home');
        });

        // Close modals clicking overlay
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) this.hideModal(modal.id);
            });
        });

        // Mobile Menu
        document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
            document.getElementById('navMenu').classList.toggle('active');
        });

        // Chat UI Listeners
        document.getElementById('openSidebarBtn')?.addEventListener('click', () => {
            document.getElementById('messagesSidebar').classList.add('open');
        });
        document.getElementById('closeSidebarBtn')?.addEventListener('click', () => {
            document.getElementById('messagesSidebar').classList.remove('open');
        });
        document.getElementById('sendMessageBtn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    // ====== Auth ======
    checkAuthState() {
        const userData = localStorage.getItem('retrievix_current_user'); // keep session in browser
        if (userData) {
            this.currentUser = JSON.parse(userData);
            this.updateUIForLoggedInUser();
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        const result = await this.apiRequest("auth/login", "POST", { email, password });

        if (result.success) {
            this.currentUser = result.user;
            localStorage.setItem('retrievix_current_user', JSON.stringify(result.user));
            this.updateUIForLoggedInUser();
            this.hideModal('loginModal');
            this.showToast('success', 'Login Successful', 'Welcome back!');
            document.getElementById('loginForm').reset();
        } else {
            this.showToast('error', 'Login Failed', result.message || 'Invalid credentials');
        }
    }

    async handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const phone = document.getElementById('registerPhone').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    // ✅ 1. Check password match
    if (password !== confirmPassword) {
        this.showToast('error', 'Registration Failed', 'Passwords do not match');
        return;
    }

    // ✅ 2. Password strength validation
    const isValid = password.length >= 8 &&
        /[A-Z]/.test(password) &&   // at least 1 uppercase
        /[a-z]/.test(password) &&   // at least 1 lowercase
        /[0-9]/.test(password) &&   // at least 1 number
        /[@$!%*?&]/.test(password); // at least 1 special char

    if (!isValid) {
        this.showToast('error', 'Weak Password',
            'Password must be 8+ chars, include uppercase, lowercase, number, and special character.');
        return;
    }

    // ✅ 3. Call backend API if valid
    const result = await this.apiRequest("auth/register", "POST", { name, email, phone, password });

    if (result.success) {
        this.currentUser = result.user;
        localStorage.setItem('retrievix_current_user', JSON.stringify(result.user));
        this.updateUIForLoggedInUser();
        this.hideModal('registerModal');
        this.showToast('success', 'Registration Successful', 'Welcome!');
        document.getElementById('registerForm').reset();
    } else {
        this.showToast('error', 'Registration Failed', result.message || 'Please try again');
    }
}

    logout() {
        this.currentUser = null;
        localStorage.removeItem('retrievix_current_user');
        this.updateUIForLoggedOutUser();
        this.navigateToPage('home');
        this.showToast('success', 'Logged Out', 'See you soon!');
    }

    updateUIForLoggedInUser() {
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        const userMenu = document.getElementById('userMenu');
        const dashboardLink = document.getElementById('dashboardLink');
        const messagesLink = document.getElementById('messagesLink');
        const historyLink = document.getElementById('historyLink');
        if (loginBtn) loginBtn.style.display = 'none';
        if (registerBtn) registerBtn.style.display = 'none';
        if (userMenu) userMenu.style.display = 'flex';
        if (dashboardLink) dashboardLink.style.display = 'block';
        if (messagesLink) messagesLink.style.display = 'block';
        if (historyLink) historyLink.style.display = 'block';
        const userName = document.getElementById('userName');
        if (userName) {
            userName.textContent = this.currentUser?.name || 'User';
            userName.style.cursor = 'pointer';
            userName.onclick = () => this.showProfile(this.currentUser._id);
        }

        // Connect Socket.IO
        if (!this.socket && typeof io !== 'undefined') {
            this.socket = io();
            this.socket.on('receive_message', (msg) => this.handleReceiveMessage(msg));
            this.loadChatRooms();
        }
    }

    updateUIForLoggedOutUser() {
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        const userMenu = document.getElementById('userMenu');
        const dashboardLink = document.getElementById('dashboardLink');
        const messagesLink = document.getElementById('messagesLink');
        const historyLink = document.getElementById('historyLink');
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (registerBtn) registerBtn.style.display = 'inline-flex';
        if (userMenu) userMenu.style.display = 'none';
        if (dashboardLink) dashboardLink.style.display = 'none';
        if (messagesLink) messagesLink.style.display = 'none';
        if (historyLink) historyLink.style.display = 'none';
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    // ====== Navigation ======
    navigateToPage(page) {
        document.getElementById('navMenu')?.classList.remove('active'); // Close mobile menu
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById(page + 'Page');
        if (el) el.classList.add('active');
        this.currentPage = page;

        if (page === 'browse') {
            this.currentPageNum = 1;
            this.loadItems();
        } else if (page === 'dashboard') {
            if (!this.currentUser) {
                this.showModal('loginModal');
                this.navigateToPage('home');
                return;
            }
            this.loadDashboard();
        } else if (page === 'history') {
            if (!this.currentUser) {
                this.showModal('loginModal');
                this.navigateToPage('home');
                return;
            }
            this.loadHistory();
        } else if (page === 'profile') {
            // Handled dynamically via showProfile
        }
    }

    // ====== Dropdowns ======
    populateDropdowns() {
        const categorySelects = document.querySelectorAll('#categoryFilter, #itemCategory');
        categorySelects.forEach(select => {
            if (!select) return;
            // clear existing
            [...select.querySelectorAll('option:not([value=""])')].forEach(o => o.remove());
            this.categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                select.appendChild(option);
            });
        });

        const locationSelect = document.getElementById('locationFilter');
        if (locationSelect) {
            // clear existing
            [...locationSelect.querySelectorAll('option:not([value=""])')].forEach(o => o.remove());
            this.commonLocations.forEach(location => {
                const option = document.createElement('option');
                option.value = location;
                option.textContent = location;
                locationSelect.appendChild(option);
            });
        }
    }

    // ====== Report ======
    showReportForm(type) {
        if (!this.currentUser) {
            this.showModal('loginModal');
            return;
        }
        this.currentReportType = type; // 'lost' | 'found'
        this.navigateToPage('report');

        if (type === 'lost') {
            document.getElementById('reportTitle').textContent = 'Report Lost Item';
            document.getElementById('reportSubtitle').textContent = 'Help us help you find your lost item';
            document.getElementById('locationLabel').textContent = 'Location Lost *';
            document.getElementById('dateLabel').textContent = 'Date Lost *';
        } else {
            document.getElementById('reportTitle').textContent = 'Report Found Item';
            document.getElementById('reportSubtitle').textContent = 'Help someone recover their lost item';
            document.getElementById('locationLabel').textContent = 'Location Found *';
            document.getElementById('dateLabel').textContent = 'Date Found *';
        }

        document.getElementById('itemDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('contactInfo').value = this.currentUser.email;
    }

    async handleReportSubmit(e) {
        e.preventDefault();

        const formData = {
            type: this.currentReportType,  // 'lost' | 'found'
            title: document.getElementById('itemName').value,
            category: document.getElementById('itemCategory').value,
            description: document.getElementById('itemDescription').value,
            location: document.getElementById('itemLocation').value,
            date: document.getElementById('itemDate').value,
            time: document.getElementById('itemTime')?.value || '',
            contactInfo: document.getElementById('contactInfo').value,
            userId: this.currentUser._id,
            image: this.uploadedImage || this.getPlaceholderImage(document.getElementById('itemCategory').value),
            status: 'active'
        };

        const data = await this.apiRequest('items', 'POST', formData);
        if (data.success) {
            this.showToast('success', 'Item Reported', `Your ${this.currentReportType} item has been reported!`);
            this.navigateToPage('dashboard');
            document.getElementById('reportForm').reset();
            this.uploadedImage = null;
            this.removeImage();
        } else {
            this.showToast('error', 'Error', data.message || 'Failed to save item');
        }
    }

    // ====== Image handling ======
    handleImageUpload(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            this.uploadedImage = ev.target.result; // Base64 string
            const img = document.getElementById('previewImg');
            const preview = document.getElementById('imagePreview');
            const placeholder = document.querySelector('.upload-placeholder');
            if (img) img.src = this.uploadedImage;
            if (preview) preview.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    removeImage() {
        this.uploadedImage = null;
        const preview = document.getElementById('imagePreview');
        const placeholder = document.querySelector('.upload-placeholder');
        const input = document.getElementById('imageInput');
        if (preview) preview.style.display = 'none';
        if (placeholder) placeholder.style.display = 'block';
        if (input) input.value = '';
    }

    getPlaceholderImage(category) {
        const placeholders = {
            'Electronics': "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzNzNkYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEycHgiPkVMRUNUUk9OSUNTPC90ZXh0Pjwvc3ZnPg==",
            'Clothing': "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y5NzMxNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEycHgiPkNMT1RISU5HPC90ZXh0Pjwvc3ZnPg==",
            'Accessories': "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzg2NTY0MyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwcHgiPkFDQ0VTU09SSUVTPC90ZXh0Pjwvc3ZnPg==",
            'Bags': "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzI1NjNlYiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0cHgiPkJBR1M8L3RleHQ+PC9zdmc+",
            'Default': "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzZiNzI4MCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEycHgiPklURU08L3RleHQ+PC9zdmc+"
        };
        return placeholders[category] || placeholders['Default'];
    }

    // ====== Tabs / Search / Pagination ======
    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`[data-tab="${tab}"]`);
        if (btn) btn.classList.add('active');
        this.currentTab = tab;
        this.currentPageNum = 1;
        this.loadItems();
    }

    async performSearch() {
        this.currentFilters = {
            search: (document.getElementById('searchInput')?.value || '').toLowerCase(),
            category: document.getElementById('categoryFilter')?.value || '',
            location: document.getElementById('locationFilter')?.value || '',
            date: document.getElementById('dateFilter')?.value || ''
        };
        this.currentPageNum = 1;

        const { search, category, location, date } = this.currentFilters;

        // If there's a search query, use the AI search endpoint
        if (search) {
            const result = await this.apiRequest(`items/search?query=${search}&type=${this.currentTab}&userId=${this.currentUser?._id}`);
            if (result.success) {
                this.renderItems(result.items);
                this.renderPagination(1); // AI search doesn't support pagination yet
            } else {
                this.renderItems([]);
                this.renderPagination(1);
            }
        } else {
            // Otherwise, load items with basic filters
            this.loadItems();
        }
    }

    async loadItems() {
        // Fetch items by tab
        const res = await fetch(`/api/items?type=${this.currentTab}`);
        const data = await res.json();
        const allItems = Array.isArray(data.items) ? data.items : [];

        // Apply filters (date uses single 'date' field in DB)
        let filteredItems = allItems.filter(item => {
            const matchesCategory = !this.currentFilters.category || item.category === this.currentFilters.category;
            const matchesLocation = !this.currentFilters.location || (item.location || '').includes(this.currentFilters.location);
            const matchesDate = !this.currentFilters.date || (item.date === this.currentFilters.date);

            return matchesCategory && matchesLocation && matchesDate;
        });

        // Pagination
        const totalItems = filteredItems.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / this.itemsPerPage));
        const startIndex = (this.currentPageNum - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const currentItems = filteredItems.slice(startIndex, endIndex);

        this.renderItems(currentItems);
        this.renderPagination(totalPages);
    }

    renderItems(items) {
        const grid = document.getElementById('itemsGrid');
        if (!grid) return;

        if (!items.length) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No items found matching your criteria.</div>';
            return;
        }

        grid.innerHTML = items.map(item => `
            <div class="item-card" onclick="app.showItemDetail('${item._id}')">
                <img src="${item.image}" alt="${item.title}" class="item-image">
                <div class="item-content">
                    <h3 class="item-title">${item.title}</h3>
                    <span class="item-category">${item.category}</span>
                    <p class="item-description">${item.description}</p>
                    <div class="item-meta">
                        <span>📍 ${item.location}</span>
                        <span>📅 ${item.date}</span>
                    </div>
                    <div class="item-actions">
                        <button class="btn btn--primary btn--sm" onclick="event.stopPropagation(); app.showContact('${item.contactInfo}')">Contact</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderPagination(totalPages) {
        const pagination = document.getElementById('pagination');
        if (!pagination) return;
        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let html = '';
        if (this.currentPageNum > 1) {
            html += `<button onclick="app.changePage(${this.currentPageNum - 1})">Previous</button>`;
        }

        for (let i = 1; i <= totalPages; i++) {
            if (i === this.currentPageNum) {
                html += `<button class="active">${i}</button>`;
            } else if (i === 1 || i === totalPages || Math.abs(i - this.currentPageNum) <= 1) {
                html += `<button onclick="app.changePage(${i})">${i}</button>`;
            } else if (i === this.currentPageNum - 2 || i === this.currentPageNum + 2) {
                html += `<span>...</span>`;
            }
        }

        if (this.currentPageNum < totalPages) {
            html += `<button onclick="app.changePage(${this.currentPageNum + 1})">Next</button>`;
        }

        pagination.innerHTML = html;
    }

    changePage(page) {
        this.currentPageNum = page;
        this.loadItems();
    }

    // ====== Item Detail ======
    async showItemDetail(itemId) {
        try {
            const res = await fetch(`/api/items/${itemId}`);
            const data = await res.json();
            if (!data.success || !data.item) {
                this.showToast('error', 'Not Found', 'Item not found');
                return;
            }

            const item = data.item;
            document.getElementById('modalItemTitle').textContent = item.title;
            
            let editDeleteHtml = '';
            if (this.currentUser && item.userId === this.currentUser._id) {
                editDeleteHtml = `
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed var(--border-dark); text-align: right;">
                        <button class="btn btn--outline btn--sm" onclick="app.deleteItem('${item._id}', '${item.type}')">Delete Item</button>
                    </div>
                `;
            }

            document.getElementById('modalItemContent').innerHTML = `
                <img src="${item.image}" alt="${item.title}" style="width: 100%; max-height: 500px; object-fit: contain; background: rgba(0,0,0,0.05); border-radius: var(--radius-sm); margin-bottom: 1rem;">
                <div style="margin-bottom: 1rem;">
                    <span class="item-category">${item.category}</span>
                    <span style="float:right; font-weight: 500; opacity: 0.8;">Reported by: ${item.contactInfo}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; background: rgba(0,0,0,0.03); padding: 1rem; border-radius: var(--radius-sm);">
                    <div><strong>📍 Location:</strong> ${item.location}</div>
                    <div><strong>📅 Date:</strong> ${item.date}</div>
                    <div><strong>⏰ Time:</strong> ${item.time || 'N/A'}</div>
                    <div><strong>ℹ️ Status:</strong> ${item.status || 'Active'}</div>
                </div>
                <p style="color: var(--text-muted);">${item.description}</p>
                ${editDeleteHtml}
            `;

            this.showModal('itemDetailModal');
        } catch (err) {
            console.error("Error loading item details:", err);
            this.showToast('error', 'Error', 'Could not load item details');
        }
    }



    // ====== Dashboard ======
    async loadDashboard() {
        await this.loadMyItems();
        await this.loadMatchSuggestions();
    }

    async loadMyItems() {
        // Fetch both types, then filter on client by userId
        const [lostRes, foundRes] = await Promise.all([
            fetch('/api/items?type=lost'),
            fetch('/api/items?type=found')
        ]);
        const lostData = await lostRes.json();
        const foundData = await foundRes.json();

        const lostItems = (lostData.items || []).filter(i => i.userId === this.currentUser._id);
        const foundItems = (foundData.items || []).filter(i => i.userId === this.currentUser._id);

        const myLostContainer = document.getElementById('myLostItems');
        const myFoundContainer = document.getElementById('myFoundItems');

        if (myLostContainer) {
            myLostContainer.innerHTML = lostItems.length ? lostItems.map(item => `
                <div class="item-list-card" onclick="app.showItemDetail('${item._id}')">
                    <img src="${item.image}" alt="${item.title}" class="item-list-image">
                    <div class="item-list-content">
                        <div class="item-list-title">${item.title}</div>
                        <div class="item-list-meta">${item.location} • ${item.date}</div>
                    </div>
                    <div class="item-list-actions">
                        <button class="btn btn--outline btn--sm" onclick="event.stopPropagation(); app.deleteItem('${item._id}', 'lost')">Delete</button>
                    </div>
                </div>
            `).join('') : '<p>No lost items reported yet.</p>';
        }

        if (myFoundContainer) {
            myFoundContainer.innerHTML = foundItems.length ? foundItems.map(item => `
                <div class="item-list-card" onclick="app.showItemDetail('${item._id}')">
                    <img src="${item.image}" alt="${item.title}" class="item-list-image">
                    <div class="item-list-content">
                        <div class="item-list-title">${item.title}</div>
                        <div class="item-list-meta">${item.location} • ${item.date}</div>
                    </div>
                    <div class="item-list-actions">
                        <button class="btn btn--outline btn--sm" onclick="event.stopPropagation(); app.deleteItem('${item._id}', 'lost')">Delete</button>
                    </div>
                </div>
            `).join('') : '<p>No found items reported yet.</p>';
        }
    }

    async loadMatchSuggestions() {
        const container = document.getElementById('matchSuggestions');
        if (!container) return;

        // Show a beautiful loading message and spinner while servers wake up
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="border: 3px solid rgba(0,0,0,0.1); border-top: 3px solid var(--color-primary, #007bff); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto 1rem;"></div>
                <p style="color: #666; margin-bottom: 0.5rem; font-weight: 500;">Searching for AI Matches...</p>
                <p style="color: #aaa; font-size: 0.85rem; margin-top: 0;">(May take up to 2 mins for free cloud servers to wake up)</p>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            </div>
        `;

        try {
            // 1. Get user's own reported items
            const [lostRes, foundRes] = await Promise.all([
                fetch('/api/items?type=lost'),
                fetch('/api/items?type=found')
            ]);
            
            const lostData = await lostRes.json();
            const foundData = await foundRes.json();

            const userItems = [
                ...(lostData.items || []).filter(i => i.userId === this.currentUser._id),
                ...(foundData.items || []).filter(i => i.userId === this.currentUser._id)
            ];

            if (userItems.length === 0) {
                container.innerHTML = '<p>Report an item to see match suggestions.</p>';
                return;
            }

            // 2. Create a list of promises to fetch matches for each user item
            const matchPromises = userItems.map(item =>
                fetch(`/api/items/${item._id}/matches`)
                    .then(res => {
                        if (!res.ok) throw new Error("Match fetch failed");
                        return res.json();
                    })
                    .then(data => data.success ? data.items.map(match => ({...match, originalItemId: item._id, originalItemType: item.type})) : [])
            );

            // 3. Wait for all match requests to complete
            const results = await Promise.all(matchPromises);
            const allSuggestions = results.flat();

            // 4. Deduplicate suggestions (an item might be a match for multiple user items)
            const uniqueSuggestions = [];
            const seenIds = new Set();

            allSuggestions.forEach(item => {
                if (!seenIds.has(item._id)) {
                    seenIds.add(item._id);
                    uniqueSuggestions.push(item);
                } else {
                    const existingIndex = uniqueSuggestions.findIndex(s => s._id === item._id);
                    if (item.matchScore > uniqueSuggestions[existingIndex].matchScore) {
                        uniqueSuggestions[existingIndex] = item;
                    }
                }
            });

            // 5. Sort by match score (highest first) and take the top 5
            uniqueSuggestions.sort((a, b) => b.matchScore - a.matchScore);
            const topSuggestions = uniqueSuggestions.slice(0, 5);

            // 6. Render the suggestions
            if (topSuggestions.length > 0) {
                container.innerHTML = topSuggestions.map(item => {
                    const isHighMatch = item.matchScore >= 80;
                    const badgeClass = isHighMatch ? 'score-high' : (item.matchScore >= 60 ? 'score-medium' : 'score-low');
                    
                    let originalItemType = item.originalItemType;
                    let originalItemId = item.originalItemId; 
                    
                    let chatRoomId = '';
                    if (originalItemId) {
                        const lostId = originalItemType === 'lost' ? originalItemId : item._id;
                        const foundId = originalItemType === 'found' ? originalItemId : item._id;
                        chatRoomId = `match_${lostId}_${foundId}`;
                    }

                    const chatBtn = (isHighMatch && chatRoomId) ? `<button class="btn btn--sm btn-chat" onclick="event.stopPropagation(); app.navigateToPage('messages'); app.openChatRoom('${chatRoomId}')">💬 Open Chat Room</button>` : '';

                    return `
                    <div class="item-list-card" onclick="app.showItemDetail('${item._id}')">
                        <img src="${item.image}" alt="${item.title}" class="item-list-image">
                        <div class="item-list-content">
                            <div class="item-list-title">
                                ${item.title} <span class="match-score-badge ${badgeClass}">${item.matchScore}% Match</span>
                            </div>
                            <div class="item-list-meta">${item.location} • ${item.date}</div> 
                            ${chatBtn}
                        </div>
                    </div>
                    `;
                }).join('');
            } else {
                container.innerHTML = '<p>No potential matches found yet.</p>';
            }
        } catch (error) {
            console.error("Match Suggestions Error:", error);
            container.innerHTML = '<p style="color: #dc3545; text-align: center; font-weight: 500;">Connection timed out while waking up servers. Please hit refresh in a few seconds!</p>';
        }
    }


    // ====== Contact Modal ======
    showContact(email) {
        const el = document.getElementById('contactEmail');
        if (el) el.textContent = email;
        this.showModal('contactModal');
    }

    // ====== Modal / Toast ======
    showModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.remove('hidden');
    }

    hideModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) el.classList.add('hidden');
        if (modalId === 'tutorialModal' && this.tutorialInterval) {
            clearInterval(this.tutorialInterval);
        }
    }

    async showProfile(userId) {
        try {
            const res = await fetch(`/api/users/${userId}/profile`);
            const data = await res.json();
            if (!data.success) {
                this.showToast('error', 'Profile Not Found', 'Could not load user profile.');
                return;
            }
            
            document.getElementById('profileName').textContent = data.user.name + "'s Profile";
            this.profileItems = data.items || [];
            this.switchProfileTab('lost');
            this.navigateToPage('profile');
        } catch (err) {
            console.error(err);
            this.showToast('error', 'Error', 'Failed to load profile.');
        }
    }

    switchProfileTab(tab) {
        document.querySelectorAll('[data-profile-tab]').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`[data-profile-tab="${tab}"]`);
        if (btn) btn.classList.add('active');

        const grid = document.getElementById('profileItemsGrid');
        if (!grid) return;

        const items = (this.profileItems || []).filter(i => i.type === tab);
        
        if (!items.length) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">No items found.</div>';
            return;
        }

        grid.innerHTML = items.map(item => `
            <div class="item-card" onclick="app.showItemDetail('${item._id}')">
                <img src="${item.image}" alt="${item.title}" class="item-image">
                <div class="item-content">
                    <h3 class="item-title">${item.title}</h3>
                    <span class="item-category">${item.category}</span>
                    <div class="item-meta">
                        <span>📍 ${item.location}</span>
                        <span>📅 ${item.date}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    showTutorial(type) {
        const title = document.getElementById('tutorialTitle');
        const content = document.getElementById('tutorialContent');
        const progress = document.getElementById('tutorialProgress');
        
        let steps = [];
        
        if (type === 'report') {
            title.textContent = "How to Report Items";
            steps = [
                { icon: '📝', text: 'Register and log in to your account.' },
                { icon: '📸', text: 'Click Report Lost or Found Item and upload a photo.' },
                { icon: '📍', text: 'Fill in detailed description, location, date, and time.' },
                { icon: '✅', text: 'Submit the report to our database.' }
            ];
        } else if (type === 'ai') {
            title.textContent = "How AI Matching Works";
            steps = [
                { icon: '🔍', text: 'Item submitted to our secure database.' },
                { icon: '🤖', text: 'AI scans and compares descriptions and images.' },
                { icon: '📧', text: 'Match email sent to both users if accuracy > 80%.' },
                { icon: '💬', text: 'A dedicated chat room is automatically created.' }
            ];
        } else if (type === 'safe') {
            title.textContent = "Safe Communication";
            steps = [
                { icon: '🤝', text: 'A strong AI match is found between two items.' },
                { icon: '🔔', text: 'Both users are notified via email and dashboard.' },
                { icon: '💬', text: 'Open the Chat Room to talk directly on the platform.' },
                { icon: '🛡️', text: 'Communicate safely without sharing personal phone numbers.' }
            ];
        }

        content.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 1rem; color: var(--primary);">${steps[0].icon}</div>
            <h4 style="font-size: 1.25rem; margin-bottom: 1rem;">${steps[0].text}</h4>
        `;
        
        progress.innerHTML = steps.map((_, i) => `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${i === 0 ? 'var(--primary)' : 'rgba(0,0,0,0.1)'};"></div>`).join('');
        
        let currentStep = 0;
        if (this.tutorialInterval) clearInterval(this.tutorialInterval);
        
        this.tutorialInterval = setInterval(() => {
            currentStep = (currentStep + 1) % steps.length;
            content.innerHTML = `
                <div style="font-size: 3rem; margin-bottom: 1rem; color: var(--primary); animation: fadeIn 0.5s;">${steps[currentStep].icon}</div>
                <h4 style="font-size: 1.25rem; margin-bottom: 1rem; animation: fadeIn 0.5s;">${steps[currentStep].text}</h4>
            `;
            progress.innerHTML = steps.map((_, i) => `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${i === currentStep ? 'var(--primary)' : 'rgba(0,0,0,0.1)'}; transition: 0.3s;"></div>`).join('');
        }, 3000);
        
        this.showModal('tutorialModal');
    }

    // ====== Delete Item ======
    async deleteItem(itemId, type) {
        if (!confirm(`Are you sure you want to delete this ${type} item? This action cannot be undone.`)) {
            return;
        }

        try {
            const result = await this.apiRequest(`items/${itemId}`, 'DELETE', {
                userId: this.currentUser._id
            });

            if (result.success) {
                this.showToast('success', 'Item Deleted', `Your ${type} item has been deleted successfully.`);
                // Refresh the dashboard to show updated items
                this.loadDashboard();
            } else {
                this.showToast('error', 'Delete Failed', result.message || 'Failed to delete item');
            }
        } catch (err) {
            console.error('Delete error:', err);
            this.showToast('error', 'Error', 'Failed to delete item. Please try again.');
        }
    }

    async loadHistory() {
        const grid = document.getElementById('historyGrid');
        if (!grid) return;
        
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Loading history...</div>';
        
        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            
            if (data.success && data.logs && data.logs.length > 0) {
                grid.innerHTML = data.logs.map(log => {
                    const d = new Date(log.timestamp).toLocaleDateString();
                    return `
                    <div class="item-card" style="border-top: 4px solid #10B981;">
                        <div class="item-content">
                            <h3 class="item-title">Matched Items</h3>
                            <div style="font-size: 0.9rem; margin-bottom: 8px;">
                                <strong>Item 1:</strong> ${log.title1} (${log.location1})<br>
                                <strong>Item 2:</strong> ${log.title2} (${log.location2})
                            </div>
                            <div class="item-meta">
                                <span>📅 Returned on: ${d}</span>
                            </div>
                            <div class="item-meta" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                                <span>Contacts:</span><br>
                                <span style="font-size: 0.8rem; opacity: 0.8">${log.contact1 || 'User A'} & ${log.contact2 || 'User B'}</span>
                            </div>
                        </div>
                    </div>
                    `;
                }).join('');
            } else {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No returned items in history yet.</div>';
            }
        } catch (err) {
            console.error('History fetch error:', err);
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Error loading history.</div>';
        }
    }

    showToast(type, title, message) {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        `;
        document.getElementById('toastContainer')?.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    // ====== Chat System ======
    async loadChatRooms() {
        const roomsList = document.getElementById('roomsList');
        if (!roomsList || !this.currentUser) return;
        
        try {
            const res = await fetch(`/api/chats/user/${this.currentUser._id}`);
            const data = await res.json();
            
            if (data.success && data.rooms && data.rooms.length > 0) {
                roomsList.innerHTML = data.rooms.map(room => {
                    // Extract other user's name
                    const otherUser = room.users.find(u => u._id !== this.currentUser._id) || room.users[0];
                    const chatName = otherUser ? `${this.currentUser.name} & ${otherUser.name}` : 'Match Chat';
                    const initials = otherUser ? otherUser.name.charAt(0) : '#';
                    
                    return `
                    <div class="room-item" onclick="app.openChatRoom('${room.roomId}', '${chatName.replace(/'/g, "\\'")}')">
                        <div class="room-avatar">${initials}</div>
                        <div class="room-info">
                            <div class="room-name">${chatName}</div>
                            <div class="room-preview">${room.itemTitle1 || 'Item'} / ${room.itemTitle2 || 'Item'}</div>
                        </div>
                    </div>
                    `;
                }).join('');
            } else {
                roomsList.innerHTML = `
                    <div class="room-item" onclick="app.openChatRoom('support_room', 'Support Team')">
                        <div class="room-avatar">S</div>
                        <div class="room-info">
                            <div class="room-name">Support Team</div>
                            <div class="room-preview">How can we help you?</div>
                        </div>
                    </div>
                `;
            }
        } catch (err) {
            console.error("Failed to load chat rooms:", err);
        }
    }

    async openChatRoom(roomId, roomName) {
        if (!this.socket) return;
        this.activeRoomId = roomId;
        this.socket.emit("join_room", roomId);
        
        const existing = document.querySelector(`.room-item[onclick*="${roomId}"]`);
        let actualName = roomName;
        if (!actualName && existing) {
            const nameEl = existing.querySelector('.room-name');
            if (nameEl) actualName = nameEl.textContent;
        }
        
        const displayRoomName = actualName || (roomId === 'support_room' ? 'Support Team' : 'Match Chat');
        
        document.getElementById('chatUserInfo').innerHTML = `<h3>${displayRoomName}</h3><span style="font-size: 0.8rem; color: #10B981;">● Online</span>`;
        document.getElementById('messageInputArea').style.display = 'flex';
        document.getElementById('messagesSidebar').classList.remove('open'); // close on mobile
        
        // Fetch history
        const stream = document.getElementById('messagesStream');
        stream.innerHTML = '<div class="chat-placeholder">Loading messages...</div>';
        
        try {
            const res = await fetch(`/api/messages/${roomId}`);
            const data = await res.json();
            if (data.success && data.messages.length > 0) {
                stream.innerHTML = data.messages.map(m => this.renderMessageHTML(m)).join('');
            } else {
                stream.innerHTML = '<div class="chat-placeholder">No messages yet. Say hi!</div>';
            }
            this.scrollToBottom();
        } catch(e) {
            stream.innerHTML = '<div class="chat-placeholder">Error loading messages.</div>';
        }

        // Add to sidebar if not there
        if (!existing) {
            document.getElementById('roomsList').insertAdjacentHTML('afterbegin', `
                <div class="room-item active" onclick="app.openChatRoom('${roomId}', '${displayRoomName.replace(/'/g, "\\'")}')">
                    <div class="room-avatar">#</div>
                    <div class="room-info">
                        <div class="room-name">${displayRoomName}</div>
                        <div class="room-preview">Tap to view</div>
                    </div>
                </div>
            `);
        }
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.room-item[onclick*="${roomId}"]`)?.classList.add('active');
    }

    renderMessageHTML(msg) {
        const isMine = msg.senderId === this.currentUser._id;
        const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        return `
            <div class="message-bubble ${isMine ? 'sent' : 'received'}">
                ${msg.message}
                <span class="message-time">${time}</span>
            </div>
        `;
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        if (!text || !this.activeRoomId || !this.currentUser) return;

        const msgData = {
            roomId: this.activeRoomId,
            senderId: this.currentUser._id,
            receiverId: 'other', // simplified
            message: text,
            timestamp: new Date().toISOString()
        };

        this.socket.emit("send_message", msgData);
        input.value = '';
    }

    handleReceiveMessage(msg) {
        if (msg.roomId === this.activeRoomId) {
            const stream = document.getElementById('messagesStream');
            const placeholder = stream.querySelector('.chat-placeholder');
            if (placeholder) placeholder.remove();
            
            stream.insertAdjacentHTML('beforeend', this.renderMessageHTML(msg));
            this.scrollToBottom();
        } else {
            // Show badge if not in room
            const badge = document.getElementById('msgBadge');
            if (badge) {
                badge.style.display = 'inline-block';
                badge.textContent = parseInt(badge.textContent) + 1;
            }
            this.showToast('success', 'New Message', 'You received a new message in another chat.');
        }
    }

    scrollToBottom() {
        const stream = document.getElementById('messagesStream');
        if (stream) {
            stream.scrollTop = stream.scrollHeight;
        }
    }
}

// Initialize
const app = new RetrievixApp();
