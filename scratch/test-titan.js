const fs = require('fs');
const nodemailer = require('nodemailer');
(async () => {
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.titan.email',
      port: 465,
      secure: true,
      auth: { user: 'admin@retrievix.in', pass: 'Soham@2304' }
    });
    const info = await t.sendMail({
      from: '"Retrievix Team" <admin@retrievix.in>',
      to: 'admin@retrievix.in',
      subject: 'Test Titan',
      text: 'Test Titan'
    });
    fs.writeFileSync('email_result.txt', 'Success: ' + JSON.stringify(info));
  } catch (e) {
    fs.writeFileSync('email_result.txt', 'Error: ' + e.message);
  }
})();
