export async function createRecoveryMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('Unsupported SMTP port');
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  return message => transport.sendMail({ ...message, from: { name: 'Olyvex', address: env.SMTP_FROM } });
}

