export interface DomainEvent<TData = unknown> {
  id: string;
  name: string;
  data: TData;
  /** timestamptz UTC ISO 字符串。 */
  occurredAt: string;
  correlationId?: string;
}

export type SubscriberHandler<TData = unknown> = (event: DomainEvent<TData>) => Promise<void> | void;
