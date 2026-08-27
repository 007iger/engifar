CREATE TABLE quiz_question_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id varchar(64) NOT NULL REFERENCES quiz_question(id) ON DELETE RESTRICT,
  content_hash char(64) NOT NULL,
  category varchar(32) NOT NULL,
  technology varchar(64) NOT NULL,
  difficulty smallint NOT NULL,
  weight smallint NOT NULL,
  answer_time_seconds smallint NOT NULL,
  instruction text NOT NULL,
  question text NOT NULL,
  choices text[] NOT NULL,
  correct_option smallint NOT NULL,
  explanation text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_question_revision_identity UNIQUE (question_id, content_hash),
  CONSTRAINT quiz_question_revision_pair UNIQUE (id, question_id),
  CONSTRAINT quiz_question_revision_difficulty_valid CHECK (difficulty BETWEEN 1 AND 3),
  CONSTRAINT quiz_question_revision_weight_positive CHECK (weight > 0),
  CONSTRAINT quiz_question_revision_answer_time_positive CHECK (answer_time_seconds > 0),
  CONSTRAINT quiz_question_revision_four_choices CHECK (array_length(choices, 1) = 4),
  CONSTRAINT quiz_question_revision_correct_option_valid CHECK (correct_option BETWEEN 0 AND 3),
  CONSTRAINT quiz_question_revision_text_not_blank CHECK (
    btrim(category) <> '' AND btrim(technology) <> '' AND btrim(instruction) <> ''
    AND btrim(question) <> '' AND btrim(explanation) <> ''
  )
);

CREATE UNIQUE INDEX quiz_question_revision_one_active
  ON quiz_question_revision (question_id)
  WHERE active;

CREATE FUNCTION prevent_quiz_question_revision_content_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.question_id, NEW.content_hash, NEW.category, NEW.technology, NEW.difficulty,
    NEW.weight, NEW.answer_time_seconds, NEW.instruction, NEW.question, NEW.choices,
    NEW.correct_option, NEW.explanation, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.question_id, OLD.content_hash, OLD.category, OLD.technology, OLD.difficulty,
    OLD.weight, OLD.answer_time_seconds, OLD.instruction, OLD.question, OLD.choices,
    OLD.correct_option, OLD.explanation, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'quiz question revisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quiz_question_revision_content_immutable
BEFORE UPDATE ON quiz_question_revision
FOR EACH ROW EXECUTE FUNCTION prevent_quiz_question_revision_content_update();

INSERT INTO quiz_question_revision (
  question_id, content_hash, category, technology, difficulty, weight,
  answer_time_seconds, instruction, question, choices, correct_option, explanation, active
)
SELECT id,
  md5(concat_ws(E'\u001f', category, technology, difficulty::text, weight::text,
    answer_time_seconds::text, instruction, question, array_to_string(choices, E'\u001e'),
    correct_option::text, explanation))
  || md5('legacy:' || concat_ws(E'\u001f', category, technology, difficulty::text, weight::text,
    answer_time_seconds::text, instruction, question, array_to_string(choices, E'\u001e'),
    correct_option::text, explanation)),
  category, technology, difficulty, weight, answer_time_seconds,
  instruction, question, choices, correct_option, explanation, true
FROM quiz_question;

ALTER TABLE session_participant_question
  ADD COLUMN question_revision_id uuid;

UPDATE session_participant_question selection
SET question_revision_id = revision.id
FROM quiz_question_revision revision
WHERE revision.question_id = selection.question_id
  AND revision.active;

ALTER TABLE session_participant_question
  ALTER COLUMN question_revision_id SET NOT NULL;

ALTER TABLE session_participant_question
  ADD CONSTRAINT session_participant_question_revision_fk
  FOREIGN KEY (question_revision_id, question_id)
  REFERENCES quiz_question_revision(id, question_id) ON DELETE RESTRICT;
