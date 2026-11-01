import {
  classifySmtpError,
  type SecurityEmailMessage,
  type SecurityEmailSendResult,
  type SecurityEmailTransport,
  type SecuritySmtpSettings,
} from "./email-transport.ts";

interface NodemailerTransporter {
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
  close(): void;
}

interface NodemailerModule {
  createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS?: boolean;
    auth: { user: string; pass: string };
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    tls: { minVersion: string; servername: string };
  }): NodemailerTransporter;
}

export type NodemailerLoader = () => Promise<NodemailerModule>;

async function defaultLoadNodemailer(): Promise<NodemailerModule> {
  const module = await import("nodemailer");
  return (module.default ?? module) as unknown as NodemailerModule;
}

/**
 * Transport SMTP Infomaniak : port 587 + STARTTLS obligatoire (`requireTLS`),
 * ou 465 en TLS implicite. Les identifiants ne sont jamais journalisés.
 */
export class NodemailerSecurityEmailTransport implements SecurityEmailTransport {
  private readonly smtp: SecuritySmtpSettings;
  private readonly load: NodemailerLoader;

  constructor(smtp: SecuritySmtpSettings, load: NodemailerLoader = defaultLoadNodemailer) {
    this.smtp = smtp;
    this.load = load;
  }

  async sendSecurityAlert(message: SecurityEmailMessage, options: { timeoutMs: number }): Promise<SecurityEmailSendResult> {
    let transporter: NodemailerTransporter | undefined;
    try {
      const nodemailer = await this.load();
      transporter = nodemailer.createTransport({
        host: this.smtp.host,
        port: this.smtp.port,
        secure: this.smtp.secure,
        requireTLS: !this.smtp.secure,
        auth: { user: this.smtp.user, pass: this.smtp.password },
        connectionTimeout: options.timeoutMs,
        greetingTimeout: options.timeoutMs,
        socketTimeout: options.timeoutMs,
        tls: { minVersion: "TLSv1.2", servername: this.smtp.host },
      });
      const info = await withTimeout(transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }), options.timeoutMs);
      const providerMessageId = typeof info.messageId === "string" && info.messageId.length <= 200
        ? info.messageId
        : null;
      return { ok: true, providerMessageId };
    } catch (error) {
      return { ok: false, failure: classifySmtpError(error) };
    } finally {
      try {
        transporter?.close();
      } catch {
        // Fermeture best effort.
      }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new DOMException("SMTP timeout", "TimeoutError")), timeoutMs);
    promise.then(resolve, reject);
  }).finally(() => clearTimeout(timer));
}
