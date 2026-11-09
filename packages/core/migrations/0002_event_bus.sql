-- Event Bus 正式版（架构 §1.2 不变式 5 / §5.7 / M12）：
-- event_outbox（事件持久化，禁 in-memory）+ subscriber_checkpoint（消费位点）+ job_dead_letter（死信，workflow 引擎与 event bus 共用）。
CREATE TABLE event_outbox (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  data           jsonb NOT NULL,
  occurred_at    timestamptz NOT NULL,
  correlation_id text,
  status         text NOT NULL DEFAULT 'pending',
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_outbox_pending_idx ON event_outbox (status, created_at);

CREATE TABLE subscriber_checkpoint (
  name          text PRIMARY KEY,
  last_event_id text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_dead_letter (
  id         text PRIMARY KEY,
  kind       text NOT NULL,
  ref_id     text,
  step_id    text,
  payload    jsonb NOT NULL,
  error      text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
