"""add distributed rate limit buckets

Revision ID: c06b7c8d9e05
Revises: bf5a6b7c8d94
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c06b7c8d9e05"
down_revision: Union[str, None] = "bf5a6b7c8d94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("key_digest", sa.String(length=64), nullable=False),
        sa.Column("window_id", sa.Integer(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("key_digest", "window_id"),
    )
    op.create_index("ix_rate_limit_buckets_window_id", "rate_limit_buckets", ["window_id"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_buckets_window_id", table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
