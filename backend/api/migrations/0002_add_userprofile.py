import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import api.models


CREATE_USERPROFILE_SQL = """
CREATE TABLE IF NOT EXISTS `api_userprofile` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `password` varchar(128) NOT NULL,
  `last_login` datetime(6) DEFAULT NULL,
  `loginid` varchar(150) NOT NULL,
  `mail` varchar(254) NOT NULL,
  `username` varchar(150) NOT NULL,
  `deptname` varchar(200) NOT NULL,
  `role` varchar(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `api_userprofile_loginid_uniq` (`loginid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

DROP_USERPROFILE_SQL = "DROP TABLE IF EXISTS `api_userprofile`;"


def fix_fk_to_userprofile(apps, schema_editor):
    """
    On existing DBs, FK constraints on requester_id/assignee_id still point to auth_user.
    Find those constraints and reroute them to api_userprofile.
    On fresh DBs (FK already points to api_userprofile), this is a no-op.
    """
    tables_columns = [
        ('api_requestdocument', 'requester_id'),
        ('api_approvalstep', 'assignee_id'),
        ('api_vochistory', 'assignee_id'),
    ]
    with schema_editor.connection.cursor() as cursor:
        for table, column in tables_columns:
            cursor.execute(
                """
                SELECT CONSTRAINT_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND COLUMN_NAME = %s
                  AND REFERENCED_TABLE_NAME = 'auth_user'
                """,
                [table, column],
            )
            row = cursor.fetchone()
            if row:
                cursor.execute(
                    f"ALTER TABLE `{table}` DROP FOREIGN KEY `{row[0]}`"
                )
                cursor.execute(
                    f"""
                    ALTER TABLE `{table}`
                    ADD CONSTRAINT `{table}_{column}_up_fk`
                    FOREIGN KEY (`{column}`) REFERENCES `api_userprofile`(`id`)
                    ON DELETE SET NULL
                    """
                )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        # Create the table only if it doesn't exist yet.
        # On existing DBs (0001 already recorded but ran old code): creates the table.
        # On fresh DBs (0001 just ran CreateModel): IF NOT EXISTS makes this a no-op.
        migrations.SeparateDatabaseAndState(
            state_operations=[],
            database_operations=[
                migrations.RunSQL(
                    sql=CREATE_USERPROFILE_SQL,
                    reverse_sql=DROP_USERPROFILE_SQL,
                ),
            ],
        ),
        # Fix FK constraints that still point to auth_user on existing DBs.
        migrations.RunPython(fix_fk_to_userprofile, noop_reverse),
    ]
