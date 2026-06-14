from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        # runserver 또는 gunicorn 프로세스에서만 스케줄러 실행
        import os
        # SKIP_SCHEDULER 환경 변수가 'true'로 설정되면 무거운 DCQ 동기화는 건너뛴다.
        # (마이그레이션 등) 다만 외부 DB 가 필요 없는 결재 알림 메일 큐 발송 잡은
        # 개발 환경에서도 자동 실행되도록 단독으로 띄운다.
        if os.environ.get('SKIP_SCHEDULER') == 'true':
            if os.environ.get('RUN_MAIN') != 'true':
                from . import scheduler
                import threading
                threading.Thread(target=scheduler.start_mail_only, daemon=True).start()
            return
        if os.environ.get('RUN_MAIN') != 'true':
            # Django dev server 는 두 번 ready() 를 호출하므로 RUN_MAIN 체크
            # gunicorn 환경에서는 RUN_MAIN 이 없으므로 무조건 실행
            from . import scheduler
            import threading
            # 별도 스레드에서 백그라운드로 실행 (블로킹 방지)
            threading.Thread(target=scheduler.start, daemon=True).start()
