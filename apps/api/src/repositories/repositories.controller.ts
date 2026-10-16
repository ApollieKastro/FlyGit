import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  addMemberSchema,
  addTeamSchema,
  commitListQuerySchema,
  compareQuerySchema,
  createRepositorySchema,
  createWebhookSchema,
  fileQuerySchema,
  repositoryListQuerySchema,
  updateFileSchema,
  updateRepositorySchema,
} from '@flygit/shared';
import type {
  CreateRepositoryInput,
  CreateWebhookInput,
  RepositoryListQuery,
  UpdateFileInput,
  UpdateRepositoryInput,
} from '@flygit/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { OptionalUser } from '../common/decorators/optional-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { RepositoriesService } from './repositories.service';
import type { RepositoryContentService } from './repository-content.service';
import type { RepositorySettingsService } from './repository-settings.service';

type OptUser = AuthUser | undefined;

@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly content: RepositoryContentService,
    private readonly settings: RepositorySettingsService,
  ) {}

  // ───────────────────────── CRUD ─────────────────────────

  @Public()
  @Get()
  list(@OptionalUser() user: OptUser, @Query(new ZodValidationPipe(repositoryListQuerySchema)) query: RepositoryListQuery) {
    return this.repos.list(user, query);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createRepositorySchema)) input: CreateRepositoryInput) {
    return this.repos.create(user, input);
  }

  @Public()
  @Get(':owner/:repo')
  get(@OptionalUser() user: OptUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.getDetail(user, owner, repo.replace(/\.git$/, ''));
  }

  @Patch(':owner/:repo')
  update(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(updateRepositorySchema)) input: UpdateRepositoryInput,
  ) {
    return this.repos.update(user, owner, repo, input);
  }

  @Delete(':owner/:repo')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.remove(user, owner, repo);
  }

  // ───────────────────────── Stars / watches / forks ─────────────────────────

  @Post(':owner/:repo/star')
  @HttpCode(200)
  star(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.toggleStar(user, owner, repo);
  }

  @Delete(':owner/:repo/star')
  @HttpCode(200)
  unstar(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.toggleStar(user, owner, repo);
  }

  @Post(':owner/:repo/watch')
  @HttpCode(200)
  watch(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.toggleWatch(user, owner, repo);
  }

  @Delete(':owner/:repo/watch')
  @HttpCode(200)
  unwatch(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.toggleWatch(user, owner, repo);
  }

  @Post(':owner/:repo/forks')
  @HttpCode(201)
  fork(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: { targetOrgSlug?: string },
  ) {
    return this.repos.fork(user, owner, repo, body?.targetOrgSlug);
  }

  // ───────────────────────── Content ─────────────────────────

  @Public()
  @Get(':owner/:repo/branches')
  branches(@OptionalUser() user: OptUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.content.listBranches(user, owner, repo);
  }

  @Post(':owner/:repo/branches')
  @HttpCode(201)
  createBranch(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: { name: string; from?: string },
  ) {
    return this.content.createBranch(user, owner, repo, body.name, body.from);
  }

  @Delete(':owner/:repo/branches/:name')
  @HttpCode(204)
  deleteBranch(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('name') name: string,
  ) {
    return this.content.deleteBranch(user, owner, repo, name);
  }

  @Public()
  @Get(':owner/:repo/tags')
  tags(@OptionalUser() user: OptUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.content.listTags(user, owner, repo);
  }

  @Public()
  @Get(':owner/:repo/commits')
  commits(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(commitListQuerySchema)) query: { ref?: string; path?: string; page: number; pageSize: number },
  ) {
    return this.content.listCommits(user, owner, repo, query);
  }

  @Public()
  @Get(':owner/:repo/commits/:sha')
  commit(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
  ) {
    return this.content.getCommit(user, owner, repo, sha);
  }

  @Public()
  @Get(':owner/:repo/compare')
  compare(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(compareQuerySchema)) query: { from: string; to: string },
  ) {
    return this.content.compare(user, owner, repo, query.from, query.to);
  }

  @Public()
  @Get(':owner/:repo/content')
  contentEntry(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(fileQuerySchema)) query: { ref?: string; path?: string },
  ) {
    // No path → directory listing; with path → file content.
    if (!query.path) return this.content.listTree(user, owner, repo, query);
    return this.content.readFile(user, owner, repo, { ref: query.ref, path: query.path });
  }

  @Put(':owner/:repo/content/*')
  updateFile(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('0') filePath: string,
    @Body(new ZodValidationPipe(updateFileSchema)) input: UpdateFileInput,
  ) {
    return this.content.updateFile(user, owner, repo, filePath ?? '', input);
  }

  @Public()
  @Get(':owner/:repo/readme')
  readme(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('ref') ref?: string,
  ) {
    return this.content.readReadme(user, owner, repo, ref);
  }

  @Public()
  @Get(':owner/:repo/blame')
  blame(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query(new ZodValidationPipe(fileQuerySchema)) query: { ref?: string; path?: string },
  ) {
    return this.content.blame(user, owner, repo, { ref: query.ref, path: query.path ?? '' });
  }

  // ───────────────────────── Members / teams ─────────────────────────

  @Get(':owner/:repo/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.listMembers(user, owner, repo);
  }

  @Post(':owner/:repo/members')
  @HttpCode(201)
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: { username: string; role: string },
  ) {
    return this.repos.addMember(user, owner, repo, body.username, body.role);
  }

  @Delete(':owner/:repo/members/:username')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('username') username: string,
  ) {
    return this.repos.removeMember(user, owner, repo, username);
  }

  @Get(':owner/:repo/teams')
  listTeams(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.repos.listTeams(user, owner, repo);
  }

  @Post(':owner/:repo/teams')
  @HttpCode(201)
  addTeam(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(addTeamSchema)) body: { teamId: string; role: string },
  ) {
    return this.repos.addTeam(user, owner, repo, body.teamId, body.role);
  }

  @Delete(':owner/:repo/teams/:teamId')
  @HttpCode(204)
  removeTeam(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('teamId') teamId: string,
  ) {
    return this.repos.removeTeam(user, owner, repo, teamId);
  }

  // ───────────────────────── Webhooks ─────────────────────────

  @Get(':owner/:repo/webhooks')
  listWebhooks(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.settings.listWebhooks(user, owner, repo);
  }

  @Post(':owner/:repo/webhooks')
  @HttpCode(201)
  createWebhook(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body(new ZodValidationPipe(createWebhookSchema)) input: CreateWebhookInput,
  ) {
    return this.settings.createWebhook(user, owner, repo, input);
  }

  @Patch(':owner/:repo/webhooks/:id')
  updateWebhook(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Body() body: { url?: string; secret?: string | null; events?: string[]; active?: boolean },
  ) {
    return this.settings.updateWebhook(user, owner, repo, id, body);
  }

  @Delete(':owner/:repo/webhooks/:id')
  @HttpCode(204)
  deleteWebhook(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
  ) {
    return this.settings.deleteWebhook(user, owner, repo, id);
  }

  // ───────────────────────── Protected branches ─────────────────────────

  @Get(':owner/:repo/protected-branches')
  listProtected(@CurrentUser() user: AuthUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.settings.listProtectedBranches(user, owner, repo);
  }

  @Post(':owner/:repo/protected-branches')
  @HttpCode(201)
  addProtected(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body()
    body: {
      pattern: string;
      requireApprovals?: number;
      requireStatusChecks?: boolean;
      allowForcePush?: boolean;
      allowDeletions?: boolean;
      allowMerges?: boolean;
      dismissStaleReviews?: boolean;
    },
  ) {
    return this.settings.addProtectedBranch(user, owner, repo, body);
  }

  @Delete(':owner/:repo/protected-branches/:id')
  @HttpCode(204)
  removeProtected(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
  ) {
    return this.settings.removeProtectedBranch(user, owner, repo, id);
  }

  // ───────────────────────── Releases ─────────────────────────

  @Public()
  @Get(':owner/:repo/releases')
  listReleases(@OptionalUser() user: OptUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.settings.listReleases(user, owner, repo);
  }

  @Post(':owner/:repo/releases')
  @HttpCode(201)
  createRelease(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body()
    body: { tagName: string; name: string; description?: string | null; draft?: boolean; prerelease?: boolean },
  ) {
    return this.settings.createRelease(user, owner, repo, body);
  }

  @Delete(':owner/:repo/releases/:id')
  @HttpCode(204)
  deleteRelease(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
  ) {
    return this.settings.deleteRelease(user, owner, repo, id);
  }

  // ───────────────────────── Wiki ─────────────────────────

  @Public()
  @Get(':owner/:repo/wiki')
  listWiki(@OptionalUser() user: OptUser, @Param('owner') owner: string, @Param('repo') repo: string) {
    return this.settings.listWikiPages(user, owner, repo);
  }

  @Public()
  @Get(':owner/:repo/wiki/:slug')
  getWiki(
    @OptionalUser() user: OptUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('slug') slug: string,
  ) {
    return this.settings.getWikiPage(user, owner, repo, slug);
  }

  @Put(':owner/:repo/wiki/:slug')
  upsertWiki(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('slug') slug: string,
    @Body() body: { title?: string; content: string },
  ) {
    return this.settings.upsertWikiPage(user, owner, repo, slug, body);
  }

  @Delete(':owner/:repo/wiki/:slug')
  @HttpCode(204)
  deleteWiki(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('slug') slug: string,
  ) {
    return this.settings.deleteWikiPage(user, owner, repo, slug);
  }
}
