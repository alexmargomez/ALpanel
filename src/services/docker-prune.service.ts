/**
 * @serviceCode services.docker_prune
 * @serviceName Limpiar Caché Global Docker del VPS
 * @serviceDescription Ejecuta Docker System & Builder Prune para liberar espacio en el disco SSD del servidor
 * @serviceIcon fa-broom
 * @defaultRoles admin
 */
import { hostService } from './host.service';

export class DockerPruneService {
  async pruneGlobalCache() {
    return hostService.pruneDockerCache();
  }
}

export const dockerPruneService = new DockerPruneService();
