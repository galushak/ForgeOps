from django.contrib.auth.models import User
from django.shortcuts import redirect
from django.urls import reverse


class FirstRunMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        allowed = {
            reverse("setup"),
            reverse("healthz"),
            reverse("login"),
        }
        if not User.objects.exists() and request.path not in allowed and not request.path.startswith("/static/"):
            return redirect("setup")
        response = self.get_response(request)
        response.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        response.setdefault("Referrer-Policy", "same-origin")
        response.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        return response
