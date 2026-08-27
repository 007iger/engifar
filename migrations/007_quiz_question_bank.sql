CREATE TABLE quiz_question (
  id varchar(64) PRIMARY KEY,
  category varchar(32) NOT NULL,
  difficulty smallint NOT NULL,
  weight smallint NOT NULL,
  answer_time_seconds smallint NOT NULL DEFAULT 15,
  instruction text NOT NULL,
  question text NOT NULL,
  choices text[] NOT NULL,
  correct_option smallint NOT NULL,
  explanation text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_question_difficulty_valid CHECK (difficulty BETWEEN 1 AND 3),
  CONSTRAINT quiz_question_weight_positive CHECK (weight > 0),
  CONSTRAINT quiz_question_answer_time_positive CHECK (answer_time_seconds > 0),
  CONSTRAINT quiz_question_four_choices CHECK (array_length(choices, 1) = 4),
  CONSTRAINT quiz_question_correct_option_valid CHECK (correct_option BETWEEN 0 AND 3),
  CONSTRAINT quiz_question_text_not_blank CHECK (
    btrim(category) <> '' AND btrim(instruction) <> '' AND btrim(question) <> ''
    AND btrim(explanation) <> ''
  )
);

CREATE INDEX quiz_question_random_selection_idx
  ON quiz_question (category, difficulty)
  WHERE active;

CREATE TABLE session_participant_question (
  game_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  question_index smallint NOT NULL,
  question_id varchar(64) NOT NULL REFERENCES quiz_question(id) ON DELETE RESTRICT,
  PRIMARY KEY (game_session_id, participant_id, question_index),
  CONSTRAINT session_participant_question_owner_fk
    FOREIGN KEY (game_session_id, participant_id)
    REFERENCES session_participant(game_session_id, participant_id) ON DELETE CASCADE,
  CONSTRAINT session_participant_question_unique
    UNIQUE (game_session_id, participant_id, question_id),
  CONSTRAINT session_participant_question_index_valid CHECK (question_index BETWEEN 0 AND 23)
);

ALTER TABLE game_session
  DROP CONSTRAINT game_session_choice_order_version_supported;

ALTER TABLE game_session
  ALTER COLUMN choice_order_version SET DEFAULT 4;

ALTER TABLE game_session
  ADD CONSTRAINT game_session_choice_order_version_supported
  CHECK (choice_order_version IN (1, 2, 3, 4));
