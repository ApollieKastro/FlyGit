import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GitHttpController } from './git-http.controller';
import { GitHooksController } from './git-hooks.controller';
import { GitCliService } from './git-cli.service';
import { GitStorageService } from './git-storage.service';
import { GitAuthService } from './git-auth.service';
import { GitSshServer } from './git-ssh.server';
import { RepositoryAccessService } from './repository-access.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

/**
 * Git transport + storage layer:
 *  - smart HTTP (`git http-backend` CGI)
 *  - embedded SSH server
 *  - bare-repository storage and hooks
 *  - repository permission resolution
 */
@Module({
  imports: [UsersModule],
  controllers: [GitHttpController, GitHooksController],
  providers: [
    GitCliService,
    GitStorageService,
    GitAuthService,
    GitSshServer,
    RepositoryAccessService,
    WebhookDispatcherService,
  ],
  exports: [
    GitCliService,
    GitStorageService,
    RepositoryAccessService,
    WebhookDispatcherService,
  ],
})
export class GitModule {}
