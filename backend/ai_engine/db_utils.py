"""
Database Connection Utility for AI Pipelines
Centralizes database connections using Django settings
File: backend/ai_engine/db_utils.py
"""

from django.conf import settings
import psycopg2
import logging

logger = logging.getLogger(__name__)


def get_db_connection_params():
    """
    Get database connection parameters from Django settings.
    Returns a dictionary compatible with psycopg2.connect()
    """
    db_config = settings.DATABASES['default']

    return {
        'host': db_config.get('HOST', 'localhost'),
        'database': db_config.get('NAME', 'exam_proctoring'),
        'user': db_config.get('USER', 'postgres'),
        'password': db_config.get('PASSWORD', ''),
        'port': db_config.get('PORT', '5432'),
    }


def get_db_connection():
    """
    Create and return a psycopg2 database connection using Django settings.

    Usage:
        conn = get_db_connection()
        cur = conn.cursor()
        # ... do database operations
        cur.close()
        conn.close()
    """
    try:
        params = get_db_connection_params()
        conn = psycopg2.connect(**params)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise


def execute_query(query, params=None, fetch=False):
    """
    Execute a database query using Django settings.

    Args:
        query (str): SQL query to execute
        params (tuple): Query parameters
        fetch (bool): Whether to fetch results

    Returns:
        If fetch=True: List of rows
        If fetch=False: None

    Usage:
        # Insert
        execute_query(
            "INSERT INTO table (col1, col2) VALUES (%s, %s)",
            ("val1", "val2")
        )

        # Select
        results = execute_query(
            "SELECT * FROM table WHERE id = %s",
            (1,),
            fetch=True
        )
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        if params:
            cur.execute(query, params)
        else:
            cur.execute(query)

        result = None
        if fetch:
            result = cur.fetchall()

        conn.commit()
        cur.close()

        return result

    except Exception as e:
        logger.error(f"Database query error: {e}")
        if conn:
            conn.rollback()
        raise

    finally:
        if conn:
            conn.close()


class DatabaseManager:
    """
    Context manager for database connections.
    Automatically handles connection opening/closing.

    Usage:
        with DatabaseManager() as (conn, cur):
            cur.execute("SELECT * FROM table")
            results = cur.fetchall()
    """

    def __init__(self):
        self.conn = None
        self.cur = None

    def __enter__(self):
        self.conn = get_db_connection()
        self.cur = self.conn.cursor()
        return self.conn, self.cur

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            # Exception occurred, rollback
            if self.conn:
                self.conn.rollback()
                logger.error(f"Database transaction rolled back: {exc_val}")
        else:
            # No exception, commit
            if self.conn:
                self.conn.commit()

        # Clean up
        if self.cur:
            self.cur.close()
        if self.conn:
            self.conn.close()

        # Don't suppress exceptions
        return False


# For backwards compatibility - provide DB_CONN dict
def get_db_conn_dict():
    """
    Returns DB_CONN dictionary for legacy code.
    Use get_db_connection() for new code.
    """
    return get_db_connection_params()