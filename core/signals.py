from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Client, ClientAddress, Project


@receiver(post_save, sender=Client)
def maintain_support_project(sender, instance, created, **kwargs):
    support = instance.projects.filter(is_support_project=True).first()
    if created and not support:
        Project.objects.create(
            client=instance,
            name="Support Calls",
            status=Project.Status.SUPPORT_ACTIVE,
            is_support_project=True,
            service_address=instance.primary_service_address,
            labor_minimum_hours=0,
        )
    elif support:
        expected = Project.Status.SUPPORT_ACTIVE if instance.status == Client.Status.ACTIVE else Project.Status.ARCHIVED
        if support.status != expected:
            support.status = expected
            support.save()


@receiver(post_save, sender=ClientAddress)
def update_support_address(sender, instance, **kwargs):
    if instance.is_primary:
        instance.client.projects.filter(is_support_project=True).update(service_address=instance)
