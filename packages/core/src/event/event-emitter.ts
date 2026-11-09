import { EventEmitter } from "node:events";
import type { DomainEvent } from "./types.js";

/** 进程内 EventEmitter 封装：只做已持久化事件的同进程广播（架构 §8.3）。 */
export class InProcessEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: DomainEvent): void {
    this.emitter.emit(event.name, event);
    this.emitter.emit("*", event);
  }

  on(name: string, handler: (event: DomainEvent) => void): this {
    this.emitter.on(name, handler);
    return this;
  }

  off(name: string, handler: (event: DomainEvent) => void): this {
    this.emitter.off(name, handler);
    return this;
  }
}
