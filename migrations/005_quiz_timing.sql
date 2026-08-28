ALTER TABLE game_session
  ADD COLUMN question_answer_time_seconds smallint[];

UPDATE game_session
SET question_answer_time_seconds = array_fill(
  answer_time_seconds,
  ARRAY[question_count]
);

ALTER TABLE game_session
  ALTER COLUMN question_answer_time_seconds SET NOT NULL;

ALTER TABLE game_session
  ADD CONSTRAINT game_session_question_times_match_count
  CHECK (
    array_length(question_answer_time_seconds, 1) = question_count
    AND 0 < ALL (question_answer_time_seconds)
  );

ALTER TABLE game_session
  ADD COLUMN question_review_started_at timestamptz,
  ADD COLUMN review_ends_at timestamptz;

ALTER TABLE game_session
  ADD CONSTRAINT game_session_review_timeline_valid
  CHECK (
    (question_review_started_at IS NULL AND review_ends_at IS NULL)
    OR (
      question_review_started_at IS NOT NULL
      AND review_ends_at IS NOT NULL
      AND question_started_at IS NOT NULL
      AND question_review_started_at >= question_started_at
      AND review_ends_at >= question_review_started_at
    )
  );
