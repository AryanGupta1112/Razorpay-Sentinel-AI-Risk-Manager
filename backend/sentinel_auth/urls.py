from django.urls import path

from .views import (
    ForgotPasswordView,
    LoginView,
    LogoutView,
    MeView,
    ResetPasswordView,
    UsersView,
    VerifyConfirmView,
    VerifySendView,
)


urlpatterns = [
    path("auth/login", LoginView.as_view()),
    path("auth/logout", LogoutView.as_view()),
    path("auth/me", MeView.as_view()),
    path("auth/forgot", ForgotPasswordView.as_view()),
    path("auth/reset", ResetPasswordView.as_view()),
    path("auth/verify/send", VerifySendView.as_view()),
    path("auth/verify/confirm", VerifyConfirmView.as_view()),
    path("users", UsersView.as_view()),
]
