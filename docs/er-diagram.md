# データベースER図

## 今回の変更

問題のDB管理と参加者別のランダム出題のため、次の2テーブルを追加しました。

- `quiz_question`: 問題本文、難易度、選択肢、正解、制限時間を持つ問題マスタ
- `session_participant_question`: セッション参加者ごとに抽選された24問と出題順を固定する中間テーブル

`session_participant_question`は`session_participant`の複合主キーを参照するため、同じセッションでも
参加者ごとに異なる問題構成を保持できます。`question_index`は0〜23で、同じ参加者に同じ問題を
重複して割り当てることはできません。

## 現在のER図

```mermaid
erDiagram
    ROOM ||--o{ PARTICIPANT : "参加者を持つ"
    ROOM ||--o{ GAME_SESSION : "ゲームを開催する"
    GAME_SESSION ||--o{ SESSION_PARTICIPANT : "参加者をスナップショットする"
    PARTICIPANT ||--o{ SESSION_PARTICIPANT : "セッションへ参加する"
    SESSION_PARTICIPANT ||--o{ ANSWER : "回答する"
    SESSION_PARTICIPANT ||--o{ SESSION_PARTICIPANT_QUESTION : "抽選問題を持つ"
    QUIZ_QUESTION ||--o{ SESSION_PARTICIPANT_QUESTION : "抽選される"

    ROOM {
        uuid id PK
        varchar code UK
        varchar status
        varchar genre
        timestamptz created_at
        timestamptz updated_at
    }

    PARTICIPANT {
        uuid id PK
        uuid room_id FK
        varchar display_name
        varchar role
        char access_token_hash UK
        timestamptz joined_at
        timestamptz last_seen_at
        timestamptz left_at
    }

    GAME_SESSION {
        uuid id PK
        uuid room_id FK
        integer session_number
        varchar status
        smallint question_count
        smallint choice_order_version
        smallint answer_time_seconds
        smallint_array question_answer_time_seconds
        smallint current_question_index
        timestamptz question_started_at
        timestamptz question_review_started_at
        timestamptz review_ends_at
        timestamptz started_at
        timestamptz finished_at
    }

    SESSION_PARTICIPANT {
        uuid game_session_id PK,FK
        uuid participant_id PK,FK
        uuid room_id FK
        varchar display_name_snapshot
        varchar role_snapshot
        boolean result_published
        timestamptz joined_at
        timestamptz left_at
    }

    ANSWER {
        uuid id PK
        uuid game_session_id FK
        uuid participant_id FK
        smallint question_index
        smallint selected_option
        integer response_time_ms
        timestamptz answered_at
    }

    QUIZ_QUESTION {
        varchar id PK
        varchar category
        smallint difficulty
        smallint weight
        smallint answer_time_seconds
        text instruction
        text question
        text_array choices
        smallint correct_option
        text explanation
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }

    SESSION_PARTICIPANT_QUESTION {
        uuid game_session_id PK,FK
        uuid participant_id PK,FK
        smallint question_index PK
        varchar question_id FK
    }
```

`schema_migrations`はマイグレーション管理用テーブルのため、このドメインER図からは省略しています。
