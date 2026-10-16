import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createMergeRequestSchema,
  mergeRequestListQuerySchema,
  mergeSchema,
  reviewCommentSchema,
  reviewSchema,
  updateMergeRequestSchema,
} from '@flygit/shared';
import type {
  CreateMergeRequestInput,
  MergeInput,
  MergeRequestListQuery,
  ReviewCommentInput,
  ReviewInput,
  UpdateMergeRequestInput,
} from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { OptionalUser } from '../common/decorators/optional-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { parseNumberParam } from '../common/utils/param.util';
import type { MergeRequestsService } from './merge-requests.service';

@Controller('repositories/:owner/:repo/merge-requests')
export class MergeRequestsController {
  constructor(private readonly mrs: MergeRequestsService) {}

  @Public()
  @Get()
  list(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(mergeRequestListQuerySchema)) query: MergeRequestListQuery,
  ) {
    return this.mrs.list(user, owner, repo, query);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(createMergeRequestSchema)) input: CreateMergeRequestInput,
  ) {
    return this.mrs.create(user, owner, repo, input);
  }

  @Public()
  @Get(':number')
  get(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.mrs.get(user, owner, repo, parseNumberParam(number, 'Merge request'));
  }

  @Patch(':number')
  update(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(updateMergeRequestSchema)) input: UpdateMergeRequestInput,
  ) {
    return this.mrs.update(user, owner, repo, parseNumberParam(number, 'Merge request'), input);
  }

  @Post(':number/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string, @Param('number') number: string) {
    return this.mrs.close(user, owner, repo, parseNumberParam(number, 'Merge request'));
  }

  @Post(':number/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string, @Param('number') number: string) {
    return this.mrs.reopen(user, owner, repo, parseNumberParam(number, 'Merge request'));
  }

  @Public()
  @Get(':number/diff')
  diff(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.mrs.diff(user, owner, repo, parseNumberParam(number, 'Merge request'), {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Public()
  @Get(':number/commits')
  commits(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.mrs.commits(user, owner, repo, parseNumberParam(number, 'Merge request'));
  }

  // ───────────────────────── Reviews ─────────────────────────

  @Post(':number/reviews')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(reviewSchema)) input: ReviewInput,
  ) {
    return this.mrs.review(user, owner, repo, parseNumberParam(number, 'Merge request'), input);
  }

  // ───────────────────────── Comments ─────────────────────────

  @Public()
  @Get(':number/comments')
  listComments(
    @OptionalUser() user: AuthUser | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    return this.mrs.listComments(user, owner, repo, parseNumberParam(number, 'Merge request'));
  }

  @Post(':number/comments')
  @HttpCode(201)
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(reviewCommentSchema)) input: ReviewCommentInput,
  ) {
    return this.mrs.addComment(user, owner, repo, parseNumberParam(number, 'Merge request'), input);
  }

  @Post('comments/:commentId/resolve')
  @HttpCode(200)
  resolveThread(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commentId') commentId: string,
  ) {
    return this.mrs.resolveThread(user, owner, repo, commentId);
  }

  // ───────────────────────── Merge ─────────────────────────

  @Post(':number/merge')
  @HttpCode(200)
  merge(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(mergeSchema)) input: MergeInput,
  ) {
    return this.mrs.merge(user, owner, repo, parseNumberParam(number, 'Merge request'), input);
  }
}
