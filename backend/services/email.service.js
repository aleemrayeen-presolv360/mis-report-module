/**
 * EMAIL SERVICE — sends a finished report to its recipients.
 *
 * Uses SMTP settings from .env (works with SES SMTP, SendGrid SMTP, Gmail...).
 * Without SMTP_HOST it only logs the email, so local development never mails real clients.
 */

const nodemailer = require('nodemailer');
const env = require('../config/env');
const { pathFor } = require('./file-storage');

const transport = env.email.smtp ? nodemailer.createTransport(env.email.smtp) : null;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {object} job  a cms.report_history row with status done (file_key set)
 */
async function sendReportEmail(job) {
  const fileTooBig = Number(job.file_size) > env.email.maxAttachmentMb * 1024 * 1024;
  const period = `${formatDate(job.date_from)} to ${formatDate(job.date_to)}`;
  const subject = `${job.template_name} · ${job.enterprise_name} · ${period}`;

  const rows = [
    ['Report', job.template_name],
    ['Enterprise', job.enterprise_name],
    ['Period', period],
    ['Rows', Number(job.row_count).toLocaleString('en-IN')],
    ['Format', job.format === 'xlsx' ? 'Excel' : 'CSV'],
  ];
  const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#16203a;max-width:600px">
  <p>Hello,</p>
  <p>Here is your scheduled report from Litelo.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    ${rows
      .map(([k, v]) => `<tr><td style="padding:6px 12px;border:1px solid #e8eaee;background:#fafafc">${k}</td>
      <td style="padding:6px 12px;border:1px solid #e8eaee">${escapeHtml(v)}</td></tr>`)
      .join('')}
  </table>
  <p>${
    fileTooBig
      ? `The file is larger than ${env.email.maxAttachmentMb} MB, so it is not attached. Download it from <b>Report → History</b> in Litelo.`
      : 'The file is attached.'
  }</p>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">This is an automated email from Litelo. Please do not reply.</p>
</div>`;

  const message = {
    from: env.email.from,
    to: job.recipients,
    subject,
    html,
    attachments: fileTooBig ? [] : [{ filename: job.file_name, path: pathFor(job.file_key) }],
  };

  if (!transport) {
    console.log(`[email] SMTP not configured — would send "${subject}" to ${job.recipients.join(', ')}`);
    return;
  }
  await transport.sendMail(message);
}

module.exports = { sendReportEmail };
