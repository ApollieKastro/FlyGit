import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createIssueSchema,
  createLabelSchema,
  issueCommentSchema,
  issueListQuerySchema,
  updateIssueSchema,
} from '@flygit/shared';
import type { CreateIssueInput, IssueListQuery, UpdateIssueInput } from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { OptionalUser } from '../common/decorators/optional-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { parseNumberParam } from '../common/utils/param.util';
import type { IssuesService } from './issues.service';

@Controller('repositories/:owner/:repo')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  // ───────────────────────── Issues ─────────────────────────

  @Public()
  @Get('issues')
  list(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(issueListQuerySchema)) query: IssueListQuery,
  ) {
    return this.issues.list(user, owner, repo, query);
  }

  @Public()
  @Get('issues/:number')
  get(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.issues.get(user, owner, repo, parseNumberParam(number, 'Issue'));
  }

  @Post('issues')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(createIssueSchema)) input: CreateIssueInput,
  ) {
    return this.issues.create(user, owner, repo, input);
  }

  @Patch('issues/:number')
  update(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) input: UpdateIssueInput,
  ) {
    return this.issues.update(user, owner, repo, parseNumberParam(number, 'Issue'), input);
  }

  @Delete('issues/:number')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.issues.remove(user, owner, repo, parseNumberParam(number, 'Issue'));
  }

  // ───────────────────────── Comments ─────────────────────────

  @Public()
  @Get('issues/:number/comments')
  listComments(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.issues.listComments(user, owner, repo, parseNumberParam(number, 'Issue'));
  }

  @Post('issues/:number/comments')
  @HttpCode(201)
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(issueCommentSchema)) body: { body: string },
  ) {
    return this.issues.addComment(user, owner, repo, parseNumberParam(number, 'Issue'), body.body);
  }

  @Patch('issues/comments/:commentId')
  updateComment(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(issueCommentSchema)) body: { body: string },
  ) {
    return this.issues.updateComment(user, owner, repo, commentId, body.body);
  }

  @Delete('issues/comments/:commentId')
  @HttpCode(204)
  deleteComment(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commentId') commentId: string,
  ) {
    return this.issues.deleteComment(user, owner, repo, commentId);
  }

  @Post('issues/comments/:commentId/reactions')
  @HttpCode(200)
  toggleReaction(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commentId') commentId: string,
    @Body() body: { emoji: string },
  ) {
    return this.issues.toggleReaction(user, owner, repo, commentId, body.emoji);
  }

  // ───────────────────────── Labels ─────────────────────────

  @Public()
  @Get('labels')
  listLabels(@OptionalUser() user: AuthUser | undefined, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.issues.listLabels(user, owner, repo);
  }

  @Post('labels')
  @HttpCode(201)
  createLabel(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(createLabelSchema)) input: { name: string; color: string; description?: string | null },
  ) {
    return this.issues.createLabel(user, owner, repo, input);
  }

  @Patch('labels/:labelId')
  updateLabel(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('labelId') labelId: string,
    @Body() input: { name?: string; color?: string; description?: string | null },
  ) {
    return this.issues.updateLabel(user, owner, repo, labelId, input);
  }

  @Delete('labels/:labelId')
  @HttpCode(204)
  deleteLabel(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('labelId') labelId: string,
  ) {
    return this.issues.deleteLabel(user, owner, repo, labelId);
  }

  // ───────────────────────── Milestones ─────────────────────────

  @Public()
  @Get('milestones')
  listMilestones(@OptionalUser() user: AuthUser | undefined, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.issues.listMilestones(user, owner, repo);
  }

  @Post('milestones')
  @HttpCode(201)
  createMilestone(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() input: { title: string; description?: string | null; dueOn?: string | null },
  ) {
    return this.issues.createMilestone(user, owner, repo, input);
  }

  @Patch('milestones/:milestoneId')
  updateMilestone(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('milestoneId') milestoneId: string,
    @Body() input: { title?: string; description?: string | null; dueOn?: string | null; state?: 'open' | 'closed' },
  ) {
    return this.issues.updateMilestone(user, owner, repo, milestoneId, input);
  }

  @Delete('milestones/:milestoneId')
  @HttpCode(204)
  deleteMilestone(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.issues.deleteMilestone(user, owner, repo, milestoneId);
  }
}
