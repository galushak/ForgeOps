.PHONY: run dev test cov lint format type docker-up docker-down

run:
	uvicorn app.main:app --reload

dev:
	python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt

test:
	pytest -q

cov:
	pytest --cov=app --cov-report=term-missing --cov-fail-under=85

lint:
	ruff check app tests

format:
	black app tests && ruff check --fix app tests

type:
	mypy app

docker-up:
	docker compose up --build

docker-down:
	docker compose down
