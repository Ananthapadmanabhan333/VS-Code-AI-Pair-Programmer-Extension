import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';

export class SecretStore {
  private logger = Logger.getInstance('SecretStore');

  constructor(private context: vscode.ExtensionContext) {}

  async storeOpenAIKey(key: string): Promise<void> {
    await this.context.secrets.store('fuelix.openai.apiKey', key);
    this.logger.info('OpenAI API key stored');
  }

  async getOpenAIKey(): Promise<string | undefined> {
    // First check secrets, then settings
    const secretKey = await this.context.secrets.get('fuelix.openai.apiKey');
    if (secretKey) return secretKey;

    const configKey = vscode.workspace.getConfiguration('fuelix').get<string>('apiKey');
    return configKey || undefined;
  }

  async storeAnthropicKey(key: string): Promise<void> {
    await this.context.secrets.store('fuelix.anthropic.apiKey', key);
    this.logger.info('Anthropic API key stored');
  }

  async getAnthropicKey(): Promise<string | undefined> {
    const secretKey = await this.context.secrets.get('fuelix.anthropic.apiKey');
    if (secretKey) return secretKey;

    const configKey = vscode.workspace.getConfiguration('fuelix').get<string>('anthropicApiKey');
    return configKey || undefined;
  }

  async deleteOpenAIKey(): Promise<void> {
    await this.context.secrets.delete('fuelix.openai.apiKey');
  }

  async deleteAnthropicKey(): Promise<void> {
    await this.context.secrets.delete('fuelix.anthropic.apiKey');
  }

  async hasAnyKey(): Promise<boolean> {
    const openai = await this.getOpenAIKey();
    const anthropic = await this.getAnthropicKey();
    return !!(openai || anthropic);
  }
}
