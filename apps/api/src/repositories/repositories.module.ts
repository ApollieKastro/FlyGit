import { Module } from '@nestjs/common';
import { GitModule } from '../git/git.module';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { RepositoryContentService } from './repository-content.service';
import { RepositorySettingsService } from './repository-settings.service';

/**
 * Repository management: CRUD, collaborators, stars/forks, git-backed
 * content (trees, commits, blame) and repository-level settings
 * (webhooks, protected branches, releases, wiki).
 */
@Module({
  imports: [GitModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, RepositoryContentService, RepositorySettingsService],
  exports: [RepositoriesService, RepositoryContentService, RepositorySettingsService],
})
export class RepositoriesModule {}
