import { Module } from '@nestjs/common';
import { GitModule } from '../git/git.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

/** Issues: CRUD, labels, milestones, comments, reactions. */
@Module({
  imports: [GitModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
