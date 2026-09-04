import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { getEnv } from "../config/env";
import { DisabledEmailProvider } from "./disabled-engagement.providers";
import type {
  EmailDeliveryRequest,
  EmailDeliveryResult,
  EmailProvider,
} from "./engagement-provider.contracts";
import {
  SendGridEmailProvider,
  SesEmailProvider,
  SmtpEmailProvider,
} from "./email.providers";

@Injectable()
export class ConfiguredEmailProvider implements EmailProvider {
  constructor(
    private readonly disabled: DisabledEmailProvider,
    private readonly smtp: SmtpEmailProvider,
    private readonly ses: SesEmailProvider,
    private readonly sendGrid: SendGridEmailProvider,
  ) {}

  private selected(): EmailProvider {
    switch (getEnv().EMAIL_PROVIDER) {
      case "smtp":
        return this.smtp;
      case "ses":
        return this.ses;
      case "sendgrid":
        return this.sendGrid;
      default:
        return this.disabled;
    }
  }

  get providerKey(): string {
    return this.selected().providerKey;
  }

  get configured(): boolean {
    return this.selected().configured;
  }

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    const provider = this.selected();
    if (!provider.configured) {
      throw new ServiceUnavailableException(
        `Email provider ${provider.providerKey} is not fully configured`,
      );
    }
    return provider.send(request);
  }
}
