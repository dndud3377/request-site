from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        # 스케줄러는 더 이상 여기서 자동 기동하지 않는다.
        # gunicorn 다중 워커마다 ready() 가 실행되어 스케줄러가 중복 기동되면,
        # 같은 DjangoJobStore 의 job 을 서로 탈취(`... no longer exists`)하고
        # 메일 큐가 이중 발송될 수 있다.
        # 스케줄러는 전용 단일 프로세스에서만 실행한다:
        #   python manage.py run_scheduler
        # (docker-compose 의 `scheduler` 서비스 참고)
        pass
