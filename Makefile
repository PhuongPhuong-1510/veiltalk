.PHONY: up down logs migrate

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	docker compose exec backend ./mvnw flyway:migrate
