import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instances: Map<string, Logger> = new Map();
  private outputChannel: vscode.OutputChannel;
  private prefix: string;

  private constructor(prefix: string) {
    this.prefix = prefix;
    this.outputChannel = vscode.window.createOutputChannel(`Fuelix AI — ${prefix}`);
  }

  static getInstance(prefix: string): Logger {
    if (!Logger.instances.has(prefix)) {
      Logger.instances.set(prefix, new Logger(prefix));
    }
    return Logger.instances.get(prefix)!;
  }

  debug(message: string, ...args: any[]): void {
    this.log('DEBUG', message, args);
  }

  info(message: string, ...args: any[]): void {
    this.log('INFO', message, args);
  }

  warn(message: string, ...args: any[]): void {
    this.log('WARN', message, args);
  }

  error(message: string, ...args: any[]): void {
    this.log('ERROR', message, args);
  }

  private log(level: string, message: string, args: any[]): void {
    const timestamp = new Date().toISOString();
    const argsStr = args.length > 0
      ? ' ' + args.map((a) => (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(' ')
      : '';
    this.outputChannel.appendLine(`[${timestamp}] [${level}] [${this.prefix}] ${message}${argsStr}`);
  }

  show(): void {
    this.outputChannel.show();
  }
}
