import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationQueryDto } from '../src/common/dto/pagination.dto';

describe('PaginationQueryDto (Unit)', () => {
  it('should use default values when parameters are omitted', () => {
    const dto = new PaginationQueryDto();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.offset).toBe(0);
  });

  it('should correctly calculate offset for custom page and limit', () => {
    const dto = new PaginationQueryDto();
    dto.page = 3;
    dto.limit = 15;
    expect(dto.offset).toBe(30);
  });

  it('should validate max limit constraint (limit <= 100)', async () => {
    const instance = plainToInstance(PaginationQueryDto, {
      page: 1,
      limit: 150, // Exceeds @Max(100)
    });

    const errors = await validate(instance);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });
});
