import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Creates and returns the nodemailer transporter using env credentials
 */
export const getEmailTransporter = () => {
  const user = process.env.EMAIL_USER || process.env.EMAILUSER;
  const pass = process.env.EMAIL_PASS || process.env.EMAILPASSWORD;

  if (!user || !pass) {
    throw new Error('Email credentials (EMAIL_USER / EMAIL_PASS) not configured in server environment');
  }

  // If specific SMTP host is configured
  if (process.env.EMAIL_HOST || process.env.MAILEMAILHOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST || process.env.MAILEMAILHOST,
      port: Number(process.env.EMAIL_PORT || process.env.EMAILPORT) || 587,
      secure: Number(process.env.EMAIL_PORT || process.env.EMAILPORT) === 465,
      auth: { user, pass }
    });
  }

  // Default to standard Gmail service
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
};

const fmtCurr = (num) => '₹' + Number(num || 0).toLocaleString('en-IN');

/**
 * Generates an executive, mobile-friendly HTML quotation email
 */
export const generateQuotationEmailHtml = ({
  quoteNo = 'QT-001',
  clientName = 'Valued Client',
  companyName = 'CRM Pro',
  message = '',
  items = [],
  subtotal = 0,
  discount = 0,
  tax = 0,
  total = 0,
  date = '',
  validUntil = '',
  terms = '',
  agent = 'Sales Team'
}) => {
  const formattedMessage = message
    ? message.replace(/\n/g, '<br/>')
    : `Please find attached details for your quotation <strong>${quoteNo}</strong>.`;

  const itemsRows = Array.isArray(items) && items.length > 0
    ? items.map((item, idx) => {
        const qty = Number(item.qty || 1);
        const rate = Number(item.rate || 0);
        const taxRate = Number(item.taxPercent || item.tax || 0);
        const lineTotal = (qty * rate) * (1 + taxRate / 100);
        return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px 10px; font-size: 13px; color: #64748b; text-align: center;">${idx + 1}</td>
            <td style="padding: 12px 10px; font-size: 13px; color: #1e293b; font-weight: 500;">
              ${item.description || item.name || 'Item'}
            </td>
            <td style="padding: 12px 10px; font-size: 13px; color: #475569; text-align: center;">${qty} ${item.unit ? `<span style="font-size: 11px; color: #94a3b8;">(${item.unit})</span>` : ''}</td>
            <td style="padding: 12px 10px; font-size: 13px; color: #475569; text-align: right;">${fmtCurr(rate)}</td>
            <td style="padding: 12px 10px; font-size: 13px; color: #475569; text-align: center;">${taxRate}%</td>
            <td style="padding: 12px 10px; font-size: 13px; color: #0f172a; font-weight: 600; text-align: right;">${fmtCurr(lineTotal)}</td>
          </tr>
        `;
      }).join('')
    : `
      <tr>
        <td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">
          Standard quotation package as agreed.
        </td>
      </tr>
    `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation ${quoteNo}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 30px 15px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 650px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 32px 36px; color: #ffffff;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle">
                    <span style="display: inline-block; padding: 4px 10px; background-color: rgba(255,255,255,0.18); border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #ffffff; margin-bottom: 8px;">
                      Official Quotation
                    </span>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                      ${companyName}
                    </h1>
                  </td>
                  <td align="right" valign="middle">
                    <div style="font-size: 13px; color: rgba(255,255,255,0.8);">Quotation Ref</div>
                    <div style="font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 0.02em;">${quoteNo}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 36px;">

              <!-- Meta Badge / Summary Bar -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; border-radius: 10px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 14px 18px; font-size: 12px; color: #64748b;">
                    <strong>Date:</strong> ${date || 'Today'}
                  </td>
                  <td style="padding: 14px 18px; font-size: 12px; color: #64748b;">
                    <strong>Valid Until:</strong> ${validUntil || '30 days'}
                  </td>
                  <td style="padding: 14px 18px; font-size: 12px; color: #64748b; text-align: right;">
                    <strong>Sales Representative:</strong> ${agent || 'Sales Team'}
                  </td>
                </tr>
              </table>

              <!-- Message Box -->
              <div style="background-color: #faf5ff; border-left: 4px solid #8b5cf6; padding: 18px 20px; border-radius: 0 8px 8px 0; margin-bottom: 28px; font-size: 14px; line-height: 1.6; color: #334155;">
                ${formattedMessage}
              </div>

              <!-- Items Table -->
              <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em;">
                Estimate Summary
              </h3>
              
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: center; width: 35px;">#</th>
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: left;">Item Description</th>
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: center; width: 70px;">Qty</th>
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: right; width: 90px;">Rate</th>
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: center; width: 55px;">Tax</th>
                    <th style="padding: 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; text-align: right; width: 105px;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>

              <!-- Totals Section -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td width="50%" valign="top">
                    ${terms ? `
                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-right: 12px;">
                        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Terms & Conditions</div>
                        <div style="font-size: 12px; color: #475569; line-height: 1.5; white-space: pre-line;">${terms}</div>
                      </div>
                    ` : ''}
                  </td>
                  <td width="50%" valign="top">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
                      <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #64748b;">Subtotal</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #1e293b; text-align: right; font-weight: 500;">${fmtCurr(subtotal)}</td>
                      </tr>
                      ${discount > 0 ? `
                        <tr>
                          <td style="padding: 6px 0; font-size: 13px; color: #dc2626;">Discount</td>
                          <td style="padding: 6px 0; font-size: 13px; color: #dc2626; text-align: right; font-weight: 500;">-${fmtCurr(discount)}</td>
                        </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #64748b;">Tax Total</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #1e293b; text-align: right; font-weight: 500;">${fmtCurr(tax)}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="border-top: 2px solid #e2e8f0; padding-top: 8px; margin-top: 6px;"></td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-size: 16px; font-weight: 700; color: #4f46e5;">Total Amount</td>
                        <td style="padding: 8px 0; font-size: 18px; font-weight: 700; color: #4f46e5; text-align: right;">${fmtCurr(total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <div style="text-align: center; margin: 30px 0 15px;">
                <p style="font-size: 14px; color: #64748b; margin: 0 0 16px;">
                  If you have any questions or wish to accept this quotation, please reply directly to this email.
                </p>
                <div style="font-size: 13px; color: #475569;">
                  Sent by <strong>${agent || 'Team'}</strong> on behalf of <strong>${companyName}</strong>
                </div>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 22px 36px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ${companyName}. All rights reserved. Generated automatically via CRM Pro.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};
