# データベースER図

## 問題・参加者メタデータ

問題のDB管理と参加者別のランダム出題のため、次の2テーブルを追加しました。

- `quiz_question`: 問題本文、難易度、選択肢、正解、制限時間を持つ問題マスタ
- `session_participant_question`: セッション参加者ごとに抽選された24問と出題順を固定する中間テーブル

`session_participant_question`は`session_participant`の複合主キーを参照するため、同じセッションでも
参加者ごとに異なる問題構成を保持できます。`question_index`は0〜23で、同じ参加者に同じ問題を
重複して割り当てることはできません。

問題の表示対象技術・言語は`quiz_question.technology`へ保存します。クルーカラーは
`participant.crew_color`へ保存し、ゲーム開始時の値を`session_participant.crew_color_snapshot`へ
複製します。これにより、将来参加者の色を変更できるようになっても過去セッションの表示を再現できます。

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
    QUIZ_QUESTION ||--o{ QUIZ_QUESTION_REVISION : "変更履歴を持つ"
    QUIZ_QUESTION_REVISION ||--o{ SESSION_PARTICIPANT_QUESTION : "出題時の版を固定する"

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
        varchar crew_color
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
        varchar crew_color_snapshot
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
        varchar technology
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

    QUIZ_QUESTION_REVISION {
        uuid id PK
        varchar question_id FK
        char content_hash
        varchar category
        varchar technology
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
    }

    SESSION_PARTICIPANT_QUESTION {
        uuid game_session_id PK,FK
        uuid participant_id PK,FK
        smallint question_index PK
        varchar question_id FK
        uuid question_revision_id FK
    }
```

`schema_migrations`はマイグレーション管理用テーブルのため、このドメインER図からは省略しています。
