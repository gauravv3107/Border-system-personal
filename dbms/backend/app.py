from flask import Flask, send_from_directory
from flask_cors import CORS
from database import init_db
from routes.auth import auth_bp
from routes.dashboard import dashboard_bp
from routes.border_patrol import border_patrol_bp
from routes.sea_marshall import sea_marshall_bp
from routes.immigration import immigration_bp
from routes.ngo import ngo_bp
from routes.refugee import refugee_bp
import os

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), 'uploads', 'photos')
os.makedirs(UPLOADS_DIR, exist_ok=True)


def create_app():
    app = Flask(
        __name__,
        static_folder=os.path.join(os.path.dirname(__file__), '..', 'frontend'),
        static_url_path=''
    )
    app.secret_key = 'dbms-dev-secret-2026'
    CORS(app, supports_credentials=True)

    with app.app_context():
        init_db()

    app.register_blueprint(auth_bp,          url_prefix='/api/auth')
    app.register_blueprint(dashboard_bp,     url_prefix='/api/dashboard')
    app.register_blueprint(border_patrol_bp, url_prefix='/api/border-patrol')
    app.register_blueprint(sea_marshall_bp,  url_prefix='/api/sea-marshall')
    app.register_blueprint(immigration_bp,   url_prefix='/api/immigration')
    app.register_blueprint(ngo_bp,           url_prefix='/api/ngo')
    app.register_blueprint(refugee_bp,       url_prefix='/api/refugee')

    @app.route('/')
    def serve_index():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/uploads/photos/<path:filename>')
    def serve_photo(filename):
        """Serve uploaded passport photos."""
        return send_from_directory(UPLOADS_DIR, filename)

    NGO_STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'ngo-frontend'))

    @app.route('/ngo-portal')
    @app.route('/ngo-portal/')
    def serve_ngo_index():
        return send_from_directory(NGO_STATIC_DIR, 'index.html')

    @app.route('/ngo-portal/<path:path>')
    def serve_ngo_static(path):
        full = os.path.join(NGO_STATIC_DIR, path)
        if os.path.exists(full):
            return send_from_directory(NGO_STATIC_DIR, path)
        return send_from_directory(NGO_STATIC_DIR, 'index.html')

    @app.route('/<path:path>')
    def serve_static(path):
        full = os.path.join(app.static_folder, path)
        if os.path.exists(full):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, 'index.html')

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5050)
