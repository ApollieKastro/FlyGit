import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/** Organization management: CRUD, members, invitations, teams, audit log. */
@Module({
  imports: [MailModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
