"""add participant session tokens

Revision ID: 1de24b3ad991
Revises: c41a80c9d27e
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "1de24b3ad991"
down_revision: Union[str, None] = "c41a80c9d27e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("participant_sessions") as batch_op:
        batch_op.add_column(sa.Column("access_token_hash", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("participant_sessions") as batch_op:
        batch_op.drop_column("access_token_hash")
