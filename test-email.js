const nodemailer = require('nodemailer');
(async () => {
  const t = nodemailer.createTransport({
    host: 'smtp.titan.email',
    port: 465,
    secure: true,
    auth: { user: 'admin@retrievix.in', pass: 'Soham@2304' }
  });
  try {
    const info = await t.sendMail({
      from: '"Retrievix Team" <admin@retrievix.in>',
      to: 'admin@retrievix.in',
      subject: 'Test',
      text: 'Test'
    });
    console.log('Success:', info.response);
  } catch (e) {
    console.error('Error:', e);
  }
})();
