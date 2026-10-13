import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const logo =
  "https://res.cloudinary.com/de9eigd4s/image/upload/v1752745499/DBSLOGO_eranso.jpg";

const transporter = nodemailer.createTransport({
  host: process.env.MAILEMAILHOST,
  port: process.env.EMAILPORT || 587,
  secure: true,
  // requireTLS: true,
  auth: {
    user: process.env.EMAILUSER,
    pass: process.env.EMAILPASSWORD,
  },
});

const sendOtpEmail = async (email, otp, name = "Reader") => {
  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: "Welcome to Delhi Book Store – Your OTP Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <a href="${process.env.BASE_URL
      }" target="_blank" style="text-decoration: none; color: white;">
            <img src="${logo}" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
            <h2 style="margin: 0;">Delhi Book Store</h2>
            <p style="font-size: 14px; margin-top: 4px;">Bringing Stories to Life</p>
          </a>
        </div>

        <!-- Body -->
        <div style="padding: 30px; background: #fff;">
          <h3 style="color: #333;">Hello ${name},</h3>
          <p style="font-size: 16px; color: #555;">
            Welcome to <strong>Delhi Book Store</strong> – a place where stories come alive and every book finds its reader. We're excited to have you on board!
          </p>
          <p style="font-size: 16px; margin-top: 20px;">
            Use the OTP below to verify your email address. This OTP is valid for <strong>10 minutes</strong>.
          </p>

          <!-- OTP Box -->
          <div style="font-size: 36px; font-weight: bold; background: #f7f7f7; color: #da7921; padding: 20px; border-radius: 10px; margin: 30px 0; text-align: center; letter-spacing: 4px;">
            ${otp}
          </div>

          <p>If you didn’t request this, you can safely ignore this email.</p>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 25px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">📚 Delhi Book Store | <a href="${process.env.BASE_URL
      }" style="color: white; text-decoration: underline;">Visit Our Website</a></p>
          <p style="margin: 5px 0 0; font-size: 13px;">© ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sentResetPasswordMail = async (email, myToken, id) => {
  try {
    const mailOptions = {
      from: process.env.EMAILUSER,
      to: email,
      subject: "Reset Your Password - Delhi Book Store",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Reset Your Password - Delhi Book Store</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background: #f5f5f5;">
  <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 10px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1); overflow: hidden;">
    
    <!-- Header -->
    <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
      <img src="${logo}" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
      <h2 style="margin: 0;">Delhi Book Store</h2>
      <p style="font-size: 14px; margin-top: 4px;">Bringing Stories to Life</p>
    </div>

    <!-- Content -->
    <div style="padding: 30px; background: #fff; color: #333; font-size: 16px; line-height: 1.6;">
      <p>Dear User,</p>
      <p>We received a request to reset the password for your <strong>Delhi Book Store</strong> account. If this was you, please click the button below to set a new password:</p>

      <p style="text-align: center;">
        <a href="${process.env.BASE_URL
        }/pages/login/forgot-password/create-new-password/${id}/${myToken}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #da7921; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 6px;">
          Reset Password
        </a>
      </p>

      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all;">
        <a href="${process.env.BASE_URL
        }/pages/login/forgot-password/create-new-password/${id}/${myToken}">
          ${process.env.BASE_URL
        }/pages/login/forgot-password/create-new-password/${id}/${myToken}
        </a>
      </p>

      <p><strong>Note:</strong> This link will expire shortly for your security.</p>
      <p style="color: red;"><strong>Important:</strong> Do not share this email or link with anyone.</p>

      <p>If you didn’t request this, you can safely ignore this email or contact our support team.</p>

      <p>Warm regards,<br><strong>Team Delhi Book Store</strong></p>
    </div>

    <!-- Footer -->
    <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 20px; text-align: center; color: white; font-size: 13px;">
      <p style="margin: 0;">📚 <a href="https://delhibookstore.com" style="color: white; text-decoration: underline;">Visit delhibookstore.com</a></p>
      <p style="margin: 4px 0 0;">&copy; ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
      `,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Mail has been sent: ", info.response);
      }
    });
  } catch (error) {
    console.error("Error while sending email: ", error);
  }
};

const sendContactEmail = async (name, email, subject, message) => {
  const mailOptions = {
    from: `"Delhi Book Store Contact Form" <${process.env.EMAILUSER}>`,
    to: process.env.EMAILUSER,
    subject: `New Contact Message: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <h2 style="margin: 0;">📩 New Contact Message</h2>
        </div>

        <div style="padding: 30px; background: #fff;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; color: #333;">
            ${message.replace(/\n/g, "<br>")}
          </div>
        </div>

        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 20px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">Delhi Book Store – You’ve received a message from your contact form.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOrderThankYouEmail = async (
  email,
  name = "Reader",
  orderId,
  orderDate,
  totalAmount
) => {
  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: `🧾 Thanks for Your Order – #${orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <a href="${process.env.BASE_URL
      }" target="_blank" style="text-decoration: none; color: white;">
            <img src="${logo}" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
            <h2 style="margin: 0;">Delhi Book Store</h2>
            <p style="font-size: 14px; margin-top: 4px;">Bringing Stories to Life</p>
          </a>
        </div>

        <!-- Body -->
        <div style="padding: 30px; background: #fff;">
          <h3 style="color: #333;">Hello ${name},</h3>
          <p style="font-size: 16px; color: #555;">
            Thank you for shopping with <strong>Delhi Book Store</strong>! We're thrilled to have you as our customer.
          </p>

          <p style="font-size: 16px; margin-top: 20px;">
            📦 <strong>Your order has been successfully placed!</strong>
          </p>

          <div style="background: #f7f7f7; padding: 20px; border-radius: 10px; margin: 30px 0;">
            <p style="margin: 0; font-size: 16px;"><strong>Order ID:</strong> #${orderId}</p>
            <p style="margin: 8px 0 0; font-size: 16px;"><strong>Order Date:</strong> ${orderDate}</p>
            <p style="margin: 8px 0 0; font-size: 16px;"><strong>Total Amount:</strong> ₹${totalAmount}</p>
          </div>

          <p style="font-size: 16px;">
            We’ll notify you once your order is on its way. Meanwhile, feel free to browse more exciting titles on our website.
          </p>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.BASE_URL
      }" style="display: inline-block; background: #da7921; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-size: 16px;">Continue Browsing</a>
          </div>

          <p style="margin-top: 30px; color: #777; font-size: 14px;">If you have any questions, just reply to this email – we're happy to help.</p>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 25px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">📚 Delhi Book Store | <a href="${process.env.BASE_URL
      }" style="color: white; text-decoration: underline;">Visit Our Website</a></p>
          <p style="margin: 5px 0 0; font-size: 13px;">© ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOrderShippedEmail = async (email, name = "Reader", orderId, trackingId, deliveryPartner) => {
  // console.log("sendOrderShippedEmail ==>", email, name, orderId, trackingId, deliveryPartner);
  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: `📦 Your Order #${orderId} Has Been Shipped!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <a href="${process.env.BASE_URL
      }" target="_blank" style="text-decoration: none; color: white;">
            <img src="${logo}" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
            <h2 style="margin: 0;">Delhi Book Store</h2>
            <p style="font-size: 14px; margin-top: 4px;">Bringing Stories to Life</p>
          </a>
        </div>

        <!-- Body -->
        <div style="padding: 30px; background: #fff;">
          <h3 style="color: #333;">Hello ${name},</h3>
          <p style="font-size: 16px; color: #555;">
            Great news! Your order <strong>#${orderId}</strong> has been shipped and is on its way to you.
          </p>

          <div style="background: #f7f7f7; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 0; font-size: 16px;"><strong>Tracking ID:</strong> ${trackingId}</p>
            <p style="margin: 5px 0 0; font-size: 16px;"><strong>Delivery Partner:</strong> ${deliveryPartner}</p>
          </div>

          <p style="font-size: 16px;">You can track your shipment using your delivery partner’s website.</p>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.BASE_URL
      }/orders" style="display: inline-block; background: #da7921; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-size: 16px;">View Your Order</a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 25px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">📚 Delhi Book Store | <a href="${process.env.BASE_URL
      }" style="color: white; text-decoration: underline;">Visit Our Website</a></p>
          <p style="margin: 5px 0 0; font-size: 13px;">© ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOrderDeliveredEmail = async (email, name = "Reader", orderId) => {

  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: `📬 Order #${orderId} Delivered – We Hope You Enjoy It!`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <a href="${process.env.BASE_URL
      }" target="_blank" style="text-decoration: none; color: white;">
            <img src="${logo
      }" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
            <h2 style="margin: 0;">Delhi Book Store</h2>
            <p style="font-size: 14px; margin-top: 4px;">Bringing Stories to Life</p>
          </a>
        </div>

        <!-- Body -->
        <div style="padding: 30px; background: #fff;">
          <h3 style="color: #333;">Hi ${name},</h3>
          <p style="font-size: 16px; color: #555;">
            Your order <strong>#${orderId}</strong> has been successfully delivered. We hope you enjoy your purchase!
          </p>

          <p style="font-size: 16px; margin-top: 20px;">
            Thank you for choosing <strong>Delhi Book Store</strong>. We look forward to serving you again soon.
          </p>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.BASE_URL
      }" style="display: inline-block; background: #da7921; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-size: 16px;">Browse More Books</a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 25px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">📚 Delhi Book Store | <a href="${process.env.BASE_URL
      }" style="color: white; text-decoration: underline;">Visit Our Website</a></p>
          <p style="margin: 5px 0 0; font-size: 13px;">© ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};


const sendWelcomeEmail = async (email, name = "Reader") => {
  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: `🎉 Welcome to Delhi Book Store, ${name}!`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.07); background-color: #fff;">
        
        <!-- Header -->
        <div style="background-color: #fff; text-align: center; padding: 30px 20px;">
          <img src="${logo}" alt="Delhi Book Store Logo" style="width: 60px; height: auto; margin-bottom: 15px;" />
         <h2 style="font-size: 28px; margin: 0; color: #000;">🎉 Welcome, <span style="color: #ff7c00;">${name}!</span></h2>

          <p style="color: #555; font-size: 15px; margin-top: 8px;">You’ve successfully joined the <strong>Delhi Book Store</strong> community.</p>
        </div>

        <!-- User Info Section -->
        <div style="background: linear-gradient(to right, #ff6a00, #ffa200); color: white; padding: 24px 30px;">
          <h3 style="margin: 0 0 12px;">🛍️ Account Summary</h3>
          <p style="margin: 6px 0;"><strong>Name:</strong> ${name}</p>
          <p style="margin: 6px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 6px 0;"><strong>Joined On:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <!-- Action Buttons -->
        <div style="padding: 28px 20px; text-align: center;">
          <p style="font-size: 15px; color: #444;">Let’s get started with your reading journey!</p>
          <a href="${process.env.BASE_URL}/pages/shop" style="display: inline-block; background-color: #ff6a00; color: white; padding: 12px 24px; margin: 10px 5px; border-radius: 6px; text-decoration: none; font-weight: 500;">Explore Book Store</a>
          <a href="${process.env.BASE_URL}/pages/userprofile" style="display: inline-block; padding: 12px 24px; margin: 10px 5px; border: 2px solid #ff6a00; border-radius: 6px; color: #ff6a00; text-decoration: none; font-weight: 500;">Go to My Account</a>
        </div>

        <!-- Footer -->
        <div style="background-color: #fafafa; text-align: center; padding: 20px;">
          <p style="font-size: 13px; color: #777;">📚 <strong>Delhi Book Store</strong> — Your gateway to great reads.</p>
          <p style="font-size: 12px; color: #aaa;">© ${new Date().getFullYear()} Delhi Book Store. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendAdminProductUploadNotification = async (
  email = 'sosophotography0@gmail.com',
  name = "Admin",
  productCount = 0,
  uploadDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
  uploadedBy = "Admin" // optional: name/role of the uploader
) => {
  const mailOptions = {
    from: `"Delhi Book Store" <${process.env.EMAILUSER}>`,
    to: email,
    subject: `📦 New Products Uploaded – Admin Notification`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #da7921; padding: 20px; color: white; text-align: center;">
          <a href="${process.env.BASE_URL}" target="_blank" style="text-decoration: none; color: white;">
            <img src="${logo}" alt="Delhi Book Store" style="height: 60px; margin-bottom: 10px;" />
            <h2 style="margin: 0;">Delhi Book Store</h2>
            <p style="font-size: 14px; margin-top: 4px;">Admin Dashboard</p>
          </a>
        </div>

        <!-- Body -->
        <div style="padding: 30px; background: #fff;">
          <h3 style="color: #333;">Hello ${name},</h3>
          <p style="font-size: 16px; color: #555;">
            This is to inform you that new products have been successfully uploaded to the <strong>Delhi Book Store</strong> inventory.
          </p>

          <div style="background: #f7f7f7; padding: 20px; border-radius: 10px; margin: 30px 0; text-align: center;">
            <p style="margin: 0; font-size: 18px; font-weight: bold; color: #333;">
              📦 ${productCount} new product${productCount !== 1 ? 's' : ''} added
            </p>
            <p style="margin: 8px 0 0; font-size: 16px; color: #555;">
              Uploaded on: ${uploadDate}
            </p>
            ${uploadedBy ? `<p style="margin: 8px 0 0; font-size: 16px; color: #555;">Uploaded by: ${uploadedBy}</p>` : ''}
          </div>

          <p style="font-size: 16px;">
            You can review, edit, or manage these products from the admin panel. Please ensure all details are accurate and approve them for listing if needed.
          </p>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.BASE_URL}/admin/products" style="display: inline-block; background: #da7921; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-size: 16px;">
              Go to Admin Panel
            </a>
          </div>

          <p style="margin-top: 30px; color: #777; font-size: 14px;">
            If you were not expecting this upload, please review the changes immediately. For any assistance, reply to this email.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: linear-gradient(to right, #da7921, #ffb347); padding: 25px; text-align: center; color: white;">
          <p style="margin: 0; font-size: 14px;">
            📚 Delhi Book Store Admin | <a href="${process.env.BASE_URL}" style="color: white; text-decoration: underline;">Visit Store</a>
          </p>
          <p style="margin: 5px 0 0; font-size: 13px;">
            © ${new Date().getFullYear()} Delhi Book Store. All rights reserved.
          </p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};


export {
  sendOtpEmail,
  sentResetPasswordMail,
  sendContactEmail,
  sendOrderThankYouEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendWelcomeEmail,
  sendAdminProductUploadNotification,
};
