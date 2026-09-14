"""add researcher auth sessions

Revision ID: 7b1c2d3e4f50
Revises: 1de24b3ad991
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "7b1c2d3e4f50"
down_revision: Union[str, None] = "1de24b3ad991"
branch_labels: Union[str, list[str], None] = None
depends_on: Union[str, list[str], None] = None


def upgrade() -> None:
    op.create_table(
        "researchers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_researchers_email"), "researchers", ["email"], unique=True)
    op.create_table(
        "researcher_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("researcher_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["researcher_id"], ["researchers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_researcher_sessions_expires_at"),
        "researcher_sessions",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_researcher_sessions_researcher_id"),
        "researcher_sessions",
        ["researcher_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_researcher_sessions_researcher_id"),
        table_name="researcher_sessions",
    )
    op.drop_index(
        op.f("ix_researcher_sessions_expires_at"),
        table_name="researcher_sessions",
    )
    op.drop_table("researcher_sessions")
    op.drop_index(op.f("ix_researchers_email"), table_name="researchers")
    op.drop_table("researchers")
