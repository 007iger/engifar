ALTER TABLE quiz_question
  ADD COLUMN technology varchar(64) NOT NULL DEFAULT 'Web';

ALTER TABLE quiz_question
  ADD CONSTRAINT quiz_question_technology_not_blank
  CHECK (btrim(technology) <> '');

ALTER TABLE participant
  ADD COLUMN crew_color varchar(7) NOT NULL DEFAULT '#54d37c';

ALTER TABLE participant
  ADD CONSTRAINT participant_crew_color_valid
  CHECK (crew_color ~ '^#[0-9a-f]{6}$');

ALTER TABLE session_participant
  ADD COLUMN crew_color_snapshot varchar(7) NOT NULL DEFAULT '#54d37c';

ALTER TABLE session_participant
  ADD CONSTRAINT session_participant_crew_color_valid
  CHECK (crew_color_snapshot ~ '^#[0-9a-f]{6}$');
