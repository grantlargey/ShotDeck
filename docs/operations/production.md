# Production operations

## Deployment

Production releases come from a clean, pushed `main` commit. Build the backend
for `linux/amd64`, publish it to ECR with the approved monolithic upload method,
and deploy its immutable tag and digest with `infra/deploy-prod.sh --skip-build`.
The script:

1. builds or validates the frontend artifact before changing the backend;
2. verifies the requested ECR tag resolves to the supplied digest;
3. registers a digest-pinned ECS task definition;
4. runs pending numbered migrations as a standalone task;
5. updates the service and verifies its task definition, count, image digest,
   health endpoint, and read-only movie endpoint; and
6. publishes and verifies the frontend only after the backend passes.

Migrations must remain compatible with the application version serving traffic
until the service update completes. An automatic backend rollback is safe only
when migrations were skipped; otherwise stop and assess the database/application
pair before changing the service.

## Recovery

Treat a database snapshot, API task definition/image, and frontend artifact as one
recovery unit. Restore matching versions together. Never start an application
version whose data contract predates the current database schema.

Keep exact production resource identifiers, credentials, recovery artifact
locations, and operator evidence outside the repository. After any deployment or
recovery, verify the ECS service is stable at its intended count, the running image
digest matches the task definition, the API health and read-only movie checks pass,
and the served frontend references the newly published assets.
