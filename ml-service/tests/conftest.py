import os

os.environ["APP_ENV"] = "prod"
os.environ["ML_SERVICE_TOKEN"] = "a-test-only-ml-token-not-for-production-123"
os.environ["PRELOAD_MODEL"] = "false"
