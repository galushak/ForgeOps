from .models import BusinessProfile


def forgeops_context(request):
    profile = BusinessProfile.objects.first()
    return {"business_profile": profile, "app_name": "ForgeOps"}
