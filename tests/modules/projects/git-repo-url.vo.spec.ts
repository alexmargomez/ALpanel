import { GitRepoUrlVO } from '../../../src/modules/projects/domain/value-objects/git-repo-url.vo';

describe('GitRepoUrlVO — Shell Command Injection Prevention', () => {
  it('acepta URLs válidas HTTPS y SSH de repositorios Git y nombres de rama válidos', () => {
    const httpsVo = new GitRepoUrlVO('https://github.com/alexmargomez/ALpanel.git');
    expect(httpsVo.value).toBe('https://github.com/alexmargomez/ALpanel.git');

    const sshVo = new GitRepoUrlVO('git@github.com:alexmargomez/ColombiaLex_API.git');
    expect(sshVo.value).toBe('git@github.com:alexmargomez/ColombiaLex_API.git');

    expect(GitRepoUrlVO.sanitizeBranch('develop')).toBe('develop');
    expect(GitRepoUrlVO.sanitizeBranch('mejora_estructural_1.0_29102026')).toBe(
      'mejora_estructural_1.0_29102026'
    );
  });

  it('bloquea intentos de Command Injection mediante subshells $(), backticks o punto y coma', () => {
    expect(
      () => new GitRepoUrlVO('https://github.com/user/repo$(whoami).git')
    ).toThrow();
    expect(
      () => new GitRepoUrlVO('https://github.com/user/`id`.git')
    ).toThrow();
    expect(
      () => new GitRepoUrlVO('https://github.com/user/repo.git;rm -rf /')
    ).toThrow();
    expect(() => GitRepoUrlVO.sanitizeBranch('--upload-pack=evil')).toThrow();
  });
});
