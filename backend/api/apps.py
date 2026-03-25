from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        # runserver 또는 gunicorn 프로세스에서만 스케줄러 실행
        import os
        if os.environ.get('RUN_MAIN') != 'true':
            # Django dev server는 두 번 ready()를 호출하므로 RUN_MAIN 체크
            # gunicorn 환경에서는 RUN_MAIN이 없으므로 무조건 실행
            from . import scheduler
            scheduler.start()
