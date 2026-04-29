"""
Remove duplicate and unused columns from auth_user table.

Removes:
- login_id, user_name, dept_name: Duplicate columns (all NULL)
- first_name, last_name: Unused Django default columns

SSO Login columns (PRESERVED):
- username: ADFS loginid/LoginId
- email: ADFS mail/Mail/email
- display_name: ADFS username/Username
- department: ADFS deptname/DeptName
- role: Custom role field
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('auth', '0011_initial'),
    ]

    operations = [
        # Remove duplicate columns (all NULL, safe to remove)
        migrations.RunSQL(
            sql="""
            ALTER TABLE auth_user DROP COLUMN login_id;
            ALTER TABLE auth_user DROP COLUMN user_name;
            ALTER TABLE auth_user DROP COLUMN dept_name;
            """,
            reverse_sql="""
            ALTER TABLE auth_user ADD COLUMN login_id VARCHAR(100) NULL;
            ALTER TABLE auth_user ADD COLUMN user_name VARCHAR(100) NULL;
            ALTER TABLE auth_user ADD COLUMN dept_name VARCHAR(200) NULL;
            """,
        ),
        
        # Remove unused Django default columns (first_name, last_name)
        # These are NOT used in SSO login flow
        migrations.RunSQL(
            sql="""
            ALTER TABLE auth_user DROP COLUMN first_name;
            ALTER TABLE auth_user DROP COLUMN last_name;
            """,
            reverse_sql="""
            ALTER TABLE auth_user ADD COLUMN first_name VARCHAR(150) NOT NULL DEFAULT '';
            ALTER TABLE auth_user ADD COLUMN last_name VARCHAR(150) NOT NULL DEFAULT '';
            """,
        ),
    ]
