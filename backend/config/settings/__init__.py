import os

if os.environ.get('DJANGO_ENV', 'dev') == 'prod':
    from .prod import *
else:
    from .dev import *
