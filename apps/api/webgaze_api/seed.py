from sqlalchemy import select

from .database import SessionLocal
from .dependencies import DEMO_OWNER_ID
from .models import ResearchProject


def seed_demo() -> None:
    with SessionLocal() as db:
        existing = db.scalar(
            select(ResearchProject).where(ResearchProject.owner_id == DEMO_OWNER_ID)
        )
        if existing:
            return
        db.add(
            ResearchProject(
                owner_id=DEMO_OWNER_ID,
                name="Accessible checkout attention study",
                research_question=(
                    "How do first-time users visually navigate pricing and checkout?"
                ),
            )
        )
        db.commit()


if __name__ == "__main__":
    seed_demo()
