export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

/** Real delivery is a later adapter. This one only records and logs. */
export interface Mailer {
  send(message: OutboundMail): Promise<void>;
}

export class DevLogMailer implements Mailer {
  readonly deliveries: OutboundMail[] = [];

  async send(message: OutboundMail): Promise<void> {
    this.deliveries.push(message);
    console.info(`[krn-01 mail] delivery recorded to=${message.to} subject=${message.subject}`);
  }
}
