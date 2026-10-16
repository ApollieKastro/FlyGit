import { Module } from '@nestjs/common';
import { GitModule } from '../git/git.module';
import { MergeRequestsController } from './merge-requests.controller';
import { MergeRequestsService } from './merge-requests.service';

/** Merge requests: creation, review workflow, diffs, merge strategies. */
@Module({
  imports: [GitModule],
  controllers: [MergeRequestsController],
  providers: [MergeRequestsService],
  exports: [MergeRequestsService],
})
export class MergeRequestsModule {}
