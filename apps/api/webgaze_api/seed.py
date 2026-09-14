from sqlalchemy import select

from .auth import hash_password
from .config import get_settings
from .database import SessionLocal
from .dependencies import DEMO_OWNER_ID
from .models import ProjectMembership, ProjectRole, Researcher, ResearchProject


def seed_demo() -> None:
    with SessionLocal() as db:
        settings = get_settings()
        if settings.demo_researcher_password:
            email = settings.demo_researcher_email.strip().lower()
            researcher = db.get(Researcher, DEMO_OWNER_ID)
            if researcher:
                researcher.email = email
                researcher.display_name = "Demo Researcher"
                researcher.password_hash = hash_password(
                    settings.demo_researcher_password.get_secret_value()
                )
                researcher.active = True
            else:
                db.add(
                    Researcher(
                        id=DEMO_OWNER_ID,
                        email=email,
                        display_name="Demo Researcher",
                        password_hash=hash_password(
                            settings.demo_researcher_password.get_secret_value()
                        ),
                    )
                )
        existing = db.scalar(
            select(ResearchProject).where(ResearchProject.owner_id == DEMO_OWNER_ID)
        )
        if not existing:
            existing = ResearchProject(
                    owner_id=DEMO_OWNER_ID,
                    name="Accessible checkout attention study",
                    research_question=(
                        "How do first-time users visually navigate pricing and checkout?"
                    ),
                )
            db.add(existing)
            db.flush()
        if settings.demo_researcher_password:
            membership = db.scalar(
                select(ProjectMembership).where(
                    ProjectMembership.project_id == existing.id,
                    ProjectMembership.researcher_id == DEMO_OWNER_ID,
                )
            )
            if not membership:
                db.add(
                    ProjectMembership(
                        project_id=existing.id,
                        researcher_id=DEMO_OWNER_ID,
                        role=ProjectRole.OWNER,
                        invited_by=DEMO_OWNER_ID,
                    )
                )
        db.commit()


if __name__ == "__main__":
    seed_demo()
